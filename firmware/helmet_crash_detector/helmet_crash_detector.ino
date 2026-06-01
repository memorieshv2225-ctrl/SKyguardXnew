/*
 ============================================================
  ESP32 Helmet Crash Detector — API for Node + React dashboard
  WiFi / GET /data / alertHistory unchanged for backend compatibility
 ============================================================
*/

#include <Wire.h>
#include <WiFi.h>
#include <WebServer.h>
#include <TinyGPS++.h>
#include <math.h>

const char* WIFI_SSID = "12";
const char* WIFI_PASS = "12345678";

#define PIN_TTP223   4
#define PIN_BUZZER   25
#define PIN_BUTTON   26
#define GPS_RX_PIN   16
#define GPS_TX_PIN   17

#define ADXL345_ADDR     0x53
#define ADXL345_POWER    0x2D
#define ADXL345_DATA_FMT 0x31
#define ADXL345_DATAX0   0x32
#define ADXL_SCALE       0.00390625f

#define G_ACCIDENT_THRESH       1.2f
#define G_COMBO_THRESH          1.2f
#define ANGLE_SPIKE_DEG         25.0f
#define ANGLE_WINDOW_MS         200
#define VIBRATION_SPIKE_THRESH  10.0f
#define CONFIRM_WAIT_MS         400
#define COUNTDOWN_SEC           20
#define HEARTBEAT_MS            500
#define FAST_SAMPLE_MS          100
#define BTN_DEBOUNCE_MS         200
#define BEEP_ON_MS              300
#define BEEP_OFF_MS             300
#define BEEP_PERIOD_MS          (BEEP_ON_MS + BEEP_OFF_MS)

enum Mode { NORMAL, FAST };
Mode currentMode = NORMAL;

enum AlertState {
  ALERT_CLEAR,
  ALERT_PENDING,
  ALERT_CANCELLED,
  ALERT_SENT,
  ALERT_GPS_REQUIRED
};
AlertState alertState = ALERT_CLEAR;

bool armed = false;
bool crashLocked = false;
bool alertSent = false;
bool buzzerOn = false;
bool helmWorn = false;
bool btnPressed = false;

bool confirmWaiting = false;
unsigned long firstCandidateMs = 0;

int countdownSec = COUNTDOWN_SEC;
int alertEventId = 0;

unsigned long crashStartMs = 0;
unsigned long lastHeartbeatMs = 0;
unsigned long lastFastSampleMs = 0;
unsigned long btnLastMs = 0;
unsigned long cancelledShowUntil = 0;

float ax = 0, ay = 0, az = 0, gForce = 0;
float pitch = 0, roll = 0;
float tilt = 0;
float prevPitch = 0, prevRoll = 0;
float prevGForce = 1.0f;
float vibration = 0;
unsigned long prevAngleMs = 0;

float pendingCaptureG = 0;
float pendingCaptureAngle = 0;

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
double gpsLat = 0, gpsLon = 0;
float gpsSpeedKmh = 0, gpsAltM = 0;
uint32_t gpsSats = 0;
String gpsUtc = "";
bool gpsFix = false;
bool usingSimGps = false;
bool locationValid = false;
String gpsStatus = "NO_FIX";

struct SimPoint { double lat; double lon; };
const SimPoint SIM_ROUTE[] = {
  {13.025958, 80.017478},
  {13.025436, 80.015771},
  {13.025792, 80.017051},
  {13.025914, 80.017076},
  {13.025875, 80.017096},
  {13.025664, 80.016691},
};
#define SIM_ROUTE_LEN 6
#define MOVE_VIB_THRESH       5.0f
#define MOVE_G_DEV_THRESH     0.10f
#define SIM_STEP_MS           2500

int simWpIndex = 0;
unsigned long lastSimAdvanceMs = 0;

#define LOG_SIZE 30
String eventLog[LOG_SIZE];
int logHead = 0, logCount = 0;

#define ALERT_HIST_SIZE 10
struct AlertRecord {
  int id;
  String utc;
  double lat;
  double lon;
  float speed;
  float gforce;
  float angle;
  String alertType;
  String status;
  String driverResponse;
};
AlertRecord alertHistory[ALERT_HIST_SIZE];
int alertHistCount = 0;

WebServer server(80);

void addLog(const String& msg) {
  String ts = String(millis() / 1000) + "s";
  eventLog[logHead] = "[" + ts + "] " + msg;
  logHead = (logHead + 1) % LOG_SIZE;
  if (logCount < LOG_SIZE) logCount++;
  Serial.println(eventLog[(logHead - 1 + LOG_SIZE) % LOG_SIZE]);
}

const char* alertStatusStr() {
  switch (alertState) {
    case ALERT_PENDING:       return "PENDING";
    case ALERT_CANCELLED:     return "CANCELLED";
    case ALERT_SENT:          return "ALERT SENT";
    case ALERT_GPS_REQUIRED:  return "GPS REQUIRED";
    default:                  return "CLEAR";
  }
}

void adxlWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(ADXL345_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

bool adxlRead() {
  Wire.beginTransmission(ADXL345_ADDR);
  Wire.write(ADXL345_DATAX0);
  Wire.endTransmission(false);
  Wire.requestFrom(ADXL345_ADDR, 6, true);
  if (Wire.available() < 6) return false;
  int16_t rx = Wire.read() | (Wire.read() << 8);
  int16_t ry = Wire.read() | (Wire.read() << 8);
  int16_t rz = Wire.read() | (Wire.read() << 8);
  ax = rx * ADXL_SCALE;
  ay = ry * ADXL_SCALE;
  az = rz * ADXL_SCALE;
  float newG = sqrt(ax * ax + ay * ay + az * az);
  vibration = fabsf(newG - prevGForce) * 100.0f;
  prevGForce = newG;
  gForce = newG;
  return true;
}

void initADXL345() {
  adxlWrite(ADXL345_POWER, 0x08);
  adxlWrite(ADXL345_DATA_FMT, 0x08);
  addLog("ADXL345 initialised");
}

void computeAngles() {
  pitch = atan2(-ax, sqrt(ay * ay + az * az)) * 180.0f / PI;
  roll  = atan2(ay, az) * 180.0f / PI;
  tilt  = max(fabsf(pitch), fabsf(roll));
}

void updateGpsFields() {
  if (gps.location.isValid()) {
    gpsLat = gps.location.lat();
    gpsLon = gps.location.lng();
    gpsFix = true;
    gpsStatus = "FIX";
  } else if (gps.charsProcessed() > 50) {
    gpsFix = false;
    gpsStatus = "SEARCHING";
  } else {
    gpsFix = false;
    gpsStatus = "NO_FIX";
  }
  gpsSpeedKmh = gps.speed.isValid() ? gps.speed.kmph() : 0;
  gpsAltM = gps.altitude.isValid() ? gps.altitude.meters() : 0;
  gpsSats = gps.satellites.isValid() ? gps.satellites.value() : 0;
  if (gps.time.isValid()) {
    char buf[32];
    snprintf(buf, sizeof(buf), "%02u:%02u:%02u",
             gps.time.hour(), gps.time.minute(), gps.time.second());
    gpsUtc = String(buf) + " UTC";
  }
}

void readGPS() {
  while (gpsSerial.available()) {
    gps.encode(gpsSerial.read());
  }
  updateGpsFields();
}

bool sensorsIndicateMoving() {
  return vibration > MOVE_VIB_THRESH || fabsf(gForce - 1.0f) > MOVE_G_DEV_THRESH;
}

bool hasLocation() {
  return gpsFix || usingSimGps;
}

void updateSimulatedLocation() {
  if (gpsFix) {
    usingSimGps = false;
    locationValid = true;
    return;
  }
  usingSimGps = true;
  locationValid = true;
  gpsLat = SIM_ROUTE[simWpIndex].lat;
  gpsLon = SIM_ROUTE[simWpIndex].lon;
  gpsStatus = sensorsIndicateMoving() ? "TRACKING" : "STATIONARY";
  gpsSpeedKmh = sensorsIndicateMoving() ? 6.0f : 0.0f;
  gpsAltM = 12.0f;
  gpsSats = 8;
  if (gpsUtc.length() == 0) {
    gpsUtc = String(millis() / 1000) + "s";
  }
  if (sensorsIndicateMoving() && millis() - lastSimAdvanceMs >= SIM_STEP_MS) {
    simWpIndex = (simWpIndex + 1) % SIM_ROUTE_LEN;
    lastSimAdvanceMs = millis();
  }
}

void updateBuzzer() {
  if (!buzzerOn) {
    digitalWrite(PIN_BUZZER, LOW);
    return;
  }
  if (currentMode == FAST && alertState == ALERT_PENDING) {
    unsigned long phase = (millis() - crashStartMs) % BEEP_PERIOD_MS;
    digitalWrite(PIN_BUZZER, phase < BEEP_ON_MS ? HIGH : LOW);
  } else if (alertSent) {
    digitalWrite(PIN_BUZZER, HIGH);
  } else {
    digitalWrite(PIN_BUZZER, LOW);
  }
}

void pushAlertHistory(float captureG, float captureAngle) {
  AlertRecord rec;
  rec.id = ++alertEventId;
  rec.utc = gpsUtc.length() ? gpsUtc : String(millis() / 1000) + "s";
  rec.lat = gpsLat;
  rec.lon = gpsLon;
  rec.speed = gpsSpeedKmh;
  rec.gforce = captureG;
  rec.angle = captureAngle;
  rec.alertType = "CRASH";
  rec.status = "ALERT SENT";
  rec.driverResponse = "NO_RESPONSE";

  for (int i = min(alertHistCount, ALERT_HIST_SIZE - 1); i > 0; i--) {
    alertHistory[i] = alertHistory[i - 1];
  }
  alertHistory[0] = rec;
  if (alertHistCount < ALERT_HIST_SIZE) alertHistCount++;
}

void enterFastMode() {
  crashLocked = true;
  currentMode = FAST;
  buzzerOn = true;
  alertState = ALERT_PENDING;
  alertSent = false;
  crashStartMs = millis();
  countdownSec = COUNTDOWN_SEC;
  pendingCaptureG = gForce;
  pendingCaptureAngle = tilt;
  confirmWaiting = false;
  addLog("FAST MODE — 20s countdown PENDING");
}

void finalizeAlertSent() {
  pushAlertHistory(pendingCaptureG, pendingCaptureAngle);
  alertSent = true;
  alertState = ALERT_SENT;
  buzzerOn = true;
  currentMode = NORMAL;
  crashLocked = false;
  countdownSec = 0;
  armed = helmWorn;
  addLog("ALERT SENT — GPS " + String(gpsLat, 6) + "," + String(gpsLon, 6));
}

void onCountdownExpired() {
  buzzerOn = false;
  digitalWrite(PIN_BUZZER, LOW);

  if (hasLocation()) {
    finalizeAlertSent();
  } else {
    alertState = ALERT_GPS_REQUIRED;
    alertSent = false;
    currentMode = NORMAL;
    crashLocked = false;
    countdownSec = 0;
    addLog("Countdown ended — GPS REQUIRED, alert pending");
  }
}

void cancelFastMode(const char* reason) {
  buzzerOn = false;
  digitalWrite(PIN_BUZZER, LOW);
  currentMode = NORMAL;
  crashLocked = false;
  countdownSec = COUNTDOWN_SEC;
  alertSent = false;
  alertState = ALERT_CANCELLED;
  confirmWaiting = false;
  cancelledShowUntil = millis() + 3000;
  addLog(reason);
}

bool isCrashCandidate() {
  unsigned long now = millis();
  float dPitch = fabsf(pitch - prevPitch);
  float dRoll  = fabsf(roll - prevRoll);
  bool angleSpike = (now - prevAngleMs < ANGLE_WINDOW_MS) &&
                    (dPitch > ANGLE_SPIKE_DEG || dRoll > ANGLE_SPIKE_DEG);
  bool gSpike = gForce > G_ACCIDENT_THRESH;
  bool vibrationSpike = vibration > VIBRATION_SPIKE_THRESH;
  bool combo = (gForce > G_COMBO_THRESH) && angleSpike && vibrationSpike;
  return gSpike || combo;
}

void checkSpike() {
  if (crashLocked || !armed || !helmWorn) return;

  computeAngles();
  unsigned long now = millis();
  bool triggered = isCrashCandidate();

  prevPitch = pitch;
  prevRoll = roll;
  prevAngleMs = now;

  if (triggered) {
    if (!confirmWaiting) {
      confirmWaiting = true;
      firstCandidateMs = now;
      addLog("Crash candidate 1 — waiting confirmation");
    } else if (now - firstCandidateMs >= CONFIRM_WAIT_MS) {
      enterFastMode();
    }
  } else {
    if (confirmWaiting && (now - firstCandidateMs > CONFIRM_WAIT_MS + 300)) {
      confirmWaiting = false;
    }
  }
}

void handleButton() {
  if (digitalRead(PIN_BUTTON) == LOW) {
    if (millis() - btnLastMs > BTN_DEBOUNCE_MS) {
      btnLastMs = millis();
      btnPressed = true;
      if (currentMode == FAST && alertState == ALERT_PENDING) {
        cancelFastMode("FALSE ALARM — operator cancelled");
      } else if (alertSent) {
        buzzerOn = false;
        digitalWrite(PIN_BUZZER, LOW);
        if (alertHistCount > 0) {
          alertHistory[0].driverResponse = "ACKNOWLEDGED";
        }
        alertSent = false;
        alertState = ALERT_CLEAR;
        addLog("Alert acknowledged");
      }
    }
  } else {
    btnPressed = false;
  }
}

void tryCompleteGpsPendingAlert() {
  if (alertState == ALERT_GPS_REQUIRED && hasLocation()) {
    finalizeAlertSent();
  }
}

String jsonEscape(const String& s) {
  String o;
  for (unsigned int i = 0; i < s.length(); i++) {
    char c = s[i];
    if (c == '"') o += "\\\"";
    else if (c == '\\') o += "\\\\";
    else o += c;
  }
  return o;
}

void handleData() {
  if (alertState == ALERT_CANCELLED && millis() > cancelledShowUntil) {
    alertState = ALERT_CLEAR;
  }

  String logJson = "[";
  int count = min(logCount, LOG_SIZE);
  for (int i = 0; i < count; i++) {
    int idx = (logHead - count + i + LOG_SIZE) % LOG_SIZE;
    logJson += "\"" + jsonEscape(eventLog[idx]) + "\"";
    if (i < count - 1) logJson += ",";
  }
  logJson += "]";

  String alertsJson = "[";
  for (int i = 0; i < alertHistCount; i++) {
    AlertRecord& a = alertHistory[i];
    alertsJson += "{";
    alertsJson += "\"id\":" + String(a.id) + ",";
    alertsJson += "\"utc\":\"" + jsonEscape(a.utc) + "\",";
    alertsJson += "\"lat\":" + String(a.lat, 6) + ",";
    alertsJson += "\"lon\":" + String(a.lon, 6) + ",";
    alertsJson += "\"speed\":" + String(a.speed, 1) + ",";
    alertsJson += "\"gforce\":" + String(a.gforce, 2) + ",";
    alertsJson += "\"angle\":" + String(a.angle, 1) + ",";
    alertsJson += "\"alertType\":\"" + a.alertType + "\",";
    alertsJson += "\"status\":\"" + a.status + "\",";
    alertsJson += "\"driverResponse\":\"" + a.driverResponse + "\"";
    alertsJson += "}";
    if (i < alertHistCount - 1) alertsJson += ",";
  }
  alertsJson += "]";

  String modeStr = (currentMode == FAST) ? "FAST" : "NORMAL";

  String json = "{";
  json += "\"mode\":\"" + modeStr + "\",";
  json += "\"worn\":" + String(helmWorn ? "true" : "false") + ",";
  json += "\"showDashboard\":" + String(helmWorn ? "true" : "false") + ",";
  json += "\"buzzer\":" + String(buzzerOn ? "true" : "false") + ",";
  json += "\"button\":" + String(btnPressed ? "true" : "false") + ",";
  json += "\"alert\":" + String(alertSent ? "true" : "false") + ",";
  json += "\"alertStatus\":\"" + String(alertStatusStr()) + "\",";
  json += "\"alertEventId\":" + String(alertEventId) + ",";
  json += "\"armed\":" + String(armed ? "true" : "false") + ",";
  json += "\"countdown\":" + String(countdownSec) + ",";
  json += "\"ax\":" + String(ax, 4) + ",";
  json += "\"ay\":" + String(ay, 4) + ",";
  json += "\"az\":" + String(az, 4) + ",";
  json += "\"gforce\":" + String(gForce, 4) + ",";
  json += "\"vibration\":" + String(vibration, 2) + ",";
  json += "\"pitch\":" + String(pitch, 2) + ",";
  json += "\"roll\":" + String(roll, 2) + ",";
  json += "\"angle\":" + String(tilt, 1) + ",";
  json += "\"tilt\":" + String(tilt, 1) + ",";
  json += "\"gpsValid\":" + String(locationValid ? "true" : "false") + ",";
  json += "\"locationSimulated\":" + String(usingSimGps ? "true" : "false") + ",";
  json += "\"landmark\":\"Saveetha School of Management\",";
  json += "\"gpsStatus\":\"" + gpsStatus + "\",";
  json += "\"lat\":" + String(gpsLat, 6) + ",";
  json += "\"lon\":" + String(gpsLon, 6) + ",";
  json += "\"speed\":" + String(gpsSpeedKmh, 1) + ",";
  json += "\"altitude\":" + String(gpsAltM, 1) + ",";
  json += "\"satellites\":" + String(gpsSats) + ",";
  json += "\"utc\":\"" + jsonEscape(gpsUtc) + "\",";
  json += "\"log\":" + logJson + ",";
  json += "\"alertHistory\":" + alertsJson;
  json += "}";

  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

void handleRoot() {
  server.send(200, "text/plain", "Helmet API — GET /data");
}

void setup() {
  Serial.begin(115200);
  Serial.println("\n=== ESP32 Helmet Crash Detector ===");

  pinMode(PIN_TTP223, INPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  digitalWrite(PIN_BUZZER, LOW);

  Wire.begin(21, 22);
  delay(100);
  initADXL345();

  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  addLog("GPS UART2 started");

  addLog("Connecting to WiFi: " + String(WIFI_SSID));
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long wStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wStart < 15000) {
    delay(500);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    addLog("WiFi connected -> http://" + WiFi.localIP().toString());
    Serial.println("\nIP: " + WiFi.localIP().toString());
    Serial.println("Backend ESP32_URL: http://" + WiFi.localIP().toString() + "/data");
  } else {
    addLog("WiFi FAILED");
  }

  server.on("/", handleRoot);
  server.on("/data", handleData);
  server.begin();
  gpsLat = SIM_ROUTE[0].lat;
  gpsLon = SIM_ROUTE[0].lon;
  usingSimGps = true;
  locationValid = true;
  gpsStatus = "STATIONARY";
  addLog("Campus route location active");
  addLog("Waiting for helmet to be worn…");
}

void loop() {
  server.handleClient();
  readGPS();

  unsigned long now = millis();
  updateSimulatedLocation();
  tryCompleteGpsPendingAlert();
  bool touchHigh = (digitalRead(PIN_TTP223) == HIGH);

  if (touchHigh && !helmWorn) {
    helmWorn = true;
    armed = true;
    addLog("Helmet WORN — detection armed");
  } else if (!touchHigh && helmWorn) {
    helmWorn = false;
    armed = false;
    confirmWaiting = false;
    addLog("Helmet NOT WORN — detection disabled");
    if (currentMode == FAST && alertState == ALERT_PENDING) {
      addLog("Worn lost during FAST — countdown continues");
    }
  }

  handleButton();

  if (currentMode == FAST && alertState == ALERT_PENDING) {
    int elapsed = (now - crashStartMs) / 1000;
    countdownSec = max(0, COUNTDOWN_SEC - elapsed);

    if (countdownSec <= 0) {
      onCountdownExpired();
    }

    if (now - lastFastSampleMs >= FAST_SAMPLE_MS) {
      lastFastSampleMs = now;
      adxlRead();
      computeAngles();
      pendingCaptureG = gForce;
      pendingCaptureAngle = tilt;
      updateSimulatedLocation();
    }
    updateBuzzer();
    return;
  }

  if (now - lastHeartbeatMs >= HEARTBEAT_MS) {
    lastHeartbeatMs = now;
    if (adxlRead()) {
      computeAngles();
      checkSpike();
      updateSimulatedLocation();
    }
    updateBuzzer();
  }
}
