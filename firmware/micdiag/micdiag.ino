// Mic diagnostic: checks whether anything drives SD, then tries SCK/WS both ways and both channels.
// Wiring: VDD->3V3, GND->GND, L/R->GND, SCK->4, WS->5, SD->6.

#include <ESP_I2S.h>

const int PIN_A = 4, PIN_B = 5, PIN_SD = 6;
static int32_t samples[4800];  // 0.1 s at 48 kHz

// Reads SD with the pull-up and then the pull-down. If the reading follows the pull, nothing drives the wire.
void checkSdPin() {
  pinMode(PIN_SD, INPUT_PULLUP);
  delay(5);
  int up = digitalRead(PIN_SD);
  pinMode(PIN_SD, INPUT_PULLDOWN);
  delay(5);
  int down = digitalRead(PIN_SD);
  Serial.printf("SD with pull-up=%d pull-down=%d -> %s\n", up, down,
                (up == 1 && down == 0) ? "follows the pull (nothing driving SD, or mic idle without clock)" : "driven by something");
}

// Returns the swing (max - min) of the samples, so a DC offset doesn't count as sound.
int32_t swingFor(int sck, int ws, i2s_std_slot_mask_t slot, int32_t *firstRaw) {
  I2SClass i2s;
  i2s.setPins(sck, ws, -1, PIN_SD);
  if (!i2s.begin(I2S_MODE_STD, 48000, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO, slot)) return -1;
  for (int i = 0; i < 4; i++) i2s.readBytes((char *)samples, sizeof(samples));  // skip start-up transient
  size_t got = i2s.readBytes((char *)samples, sizeof(samples)) / 4;
  int32_t lo = INT32_MAX, hi = INT32_MIN;
  for (size_t i = 0; i < got; i++) {
    int32_t s = samples[i] >> 14;
    lo = min(lo, s);
    hi = max(hi, s);
  }
  *firstRaw = got ? samples[got / 2] : 0;
  i2s.end();
  return got ? hi - lo : -2;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
}

void loop() {
  checkSdPin();
  const char *names[] = {"sck=4 ws=5 left ", "sck=4 ws=5 right", "sck=5 ws=4 left ", "sck=5 ws=4 right"};
  int sck[] = {PIN_A, PIN_A, PIN_B, PIN_B}, ws[] = {PIN_B, PIN_B, PIN_A, PIN_A};
  i2s_std_slot_mask_t slot[] = {I2S_STD_SLOT_LEFT, I2S_STD_SLOT_RIGHT, I2S_STD_SLOT_LEFT, I2S_STD_SLOT_RIGHT};
  for (int i = 0; i < 4; i++) {
    int32_t raw;
    int32_t swing = swingFor(sck[i], ws[i], slot[i], &raw);
    Serial.printf("%s swing %7ld  raw %08lx\n", names[i], (long)swing, (unsigned long)raw);
  }
  Serial.println("--");
  delay(1000);
}
