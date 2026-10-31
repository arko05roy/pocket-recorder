// Mic check: reads the INMP441 over I2S and prints a loudness bar 10 times a second.
// Wiring: VDD->3V3, GND->GND, L/R->GND, SCK->4, WS->5, SD->6.

#include <ESP_I2S.h>

const int PIN_SCK = 4, PIN_WS = 5, PIN_SD = 6;
I2SClass i2s;
int32_t samples[4800];  // 0.1 s at 48 kHz

void setup() {
  Serial.begin(115200);
  delay(1500);
  i2s.setPins(PIN_SCK, PIN_WS, -1, PIN_SD);
  // The INMP441 sends 24-bit samples in 32-bit slots; L/R tied to GND puts it on the left channel.
  if (!i2s.begin(I2S_MODE_STD, 48000, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO, I2S_STD_SLOT_LEFT)) {
    Serial.println("i2s init failed");
    while (true) delay(1000);
  }
  // The mic outputs a large start-up transient for ~0.25 s after the clock starts: throw it away.
  for (int i = 0; i < 5; i++) i2s.readBytes((char *)samples, sizeof(samples));
  Serial.println("mic ready");
}

void loop() {
  size_t got = i2s.readBytes((char *)samples, sizeof(samples)) / 4;
  // The mic adds a constant DC offset; subtract the block's average so only the sound (the swing) is measured.
  int64_t sum = 0;
  for (size_t i = 0; i < got; i++) sum += samples[i] >> 14;  // roughly 16-bit range
  int32_t mean = got ? sum / (int64_t)got : 0;
  int32_t peak = 0;
  for (size_t i = 0; i < got; i++) {
    int32_t s = (samples[i] >> 14) - mean;
    if (abs(s) > peak) peak = abs(s);
  }
  int bar = min(50, (int)(peak / 20));  // speech is roughly 100-1000 on this scale
  Serial.printf("%6ld |%.*s\n", (long)peak, bar, "##################################################");
}
