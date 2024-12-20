/**
 * Copyright (c) 2011-2013 Marcus Geelnard
 *
 * This software is provided 'as-is', without any express or implied
 * warranty. In no event will the authors be held liable for any damages
 * arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 *
 * 1. The origin of this software must not be misrepresented; you must not
 *    claim that you wrote the original software. If you use this software
 *    in a product, an acknowledgment in the product documentation would be
 *    appreciated but is not required.
 *
 * 2. Altered source versions must be plainly marked as such, and must not be
 *    misrepresented as being the original software.
 *
 * 3. This notice may not be removed or altered from any source
 *    distribution.
 */
export class SoundBoxPlayer {
  private mSong;

  private readonly mLastRow;

  private mCurrentCol;

  private readonly mNumWords;

  private readonly mMixBuf;

  constructor(song) {
    // Define the song
    this.mSong = song;

    // Init iteration state variables
    this.mLastRow = song.endPattern;
    this.mCurrentCol = 0;

    // Prepare song info
    this.mNumWords = song.rowLen * song.patternLen * (this.mLastRow + 1) * 2;

    // Create work buffer (initially cleared)
    this.mMixBuf = new Int32Array(this.mNumWords);
  }

  public generate = (): number => {
    // Local variables
    let col, cp, f, i, j, k, n, p, row, rowStartSample, rsample, t;

    // Put performance critical items in local variables
    const chnBuf = new Int32Array(this.mNumWords),
      instr = this.mSong.songData[this.mCurrentCol],
      { rowLen } = this.mSong,
      { patternLen } = this.mSong;

    // Clear effect state
    let band = 0,
      high,
      low = 0,
      filterActive = false,
      lsample,
      // Clear note cache.
      noteCache = [];

    // Patterns
    for (p = 0; p <= this.mLastRow; ++p) {
      cp = instr.p[p];

      // Pattern rows
      for (row = 0; row < patternLen; ++row) {
        // Execute effect command.
        const cmdNo = cp ? instr.c[cp - 1].f[row] : 0;
        if (cmdNo) {
          instr.i[cmdNo - 1] = instr.c[cp - 1].f[row + patternLen] || 0;

          // Clear the note cache since the instrument has changed.
          if (cmdNo < 16) {
            noteCache = [];
          }
        }

        // Put performance critical instrument properties in local variables
        const oscLFO = this.mOscillators[instr.i[15]],
          lfoAmt = instr.i[16] / 512,
          lfoFreq = 2 ** (instr.i[17] - 9) / rowLen,
          fxLFO = instr.i[18],
          fxFilter = instr.i[19],
          fxFreq = (instr.i[20] * 43.23529 * 3.141592) / 44100,
          q = 1 - instr.i[21] / 255,
          dist = instr.i[22] * 1e-5,
          drive = instr.i[23] / 32,
          panAmt = instr.i[24] / 512,
          panFreq = (6.283184 * 2 ** (instr.i[25] - 9)) / rowLen,
          dlyAmt = instr.i[26] / 255,
          dly = (instr.i[27] * rowLen) & ~1; // Must be an even number

        // Calculate start sample number for this row in the pattern
        rowStartSample = (p * patternLen + row) * rowLen;

        // Generate notes for this pattern row
        for (col = 0; col < 4; ++col) {
          n = cp ? instr.c[cp - 1].n[row + col * patternLen] : 0;
          if (n) {
            if (!noteCache[n]) {
              noteCache[n] = this.createNote(instr, n, rowLen);
            }

            // Copy note from the note cache
            const noteBuf = noteCache[n];
            for (
              j = 0, i = rowStartSample * 2;
              j < noteBuf.length;
              j++, i += 2
            ) {
              chnBuf[i] += noteBuf[j];
            }
          }
        }

        // Perform effects for this pattern row
        for (j = 0; j < rowLen; j++) {
          // Dry mono-sample
          k = (rowStartSample + j) * 2;
          rsample = chnBuf[k];

          // We only do effects if we have some sound input
          if (rsample || filterActive) {
            // State variable filter
            f = fxFreq;
            if (fxLFO) {
              f *= oscLFO(lfoFreq * k) * lfoAmt + 0.5;
            }
            f = 1.5 * Math.sin(f);
            low += f * band;
            high = q * (rsample - band) - low;
            band += f * high;
            rsample = fxFilter == 3 ? band : fxFilter == 1 ? high : low;

            // Distortion
            if (dist) {
              rsample *= dist;
              rsample =
                rsample < 1
                  ? rsample > -1
                    ? this.oscSin(rsample * 0.25)
                    : -1
                  : 1;
              rsample /= dist;
            }

            // Drive
            rsample *= drive;

            // Is the filter active (i.e. still audiable)?
            filterActive = rsample * rsample > 1e-5;

            // Panning
            t = Math.sin(panFreq * k) * panAmt + 0.5;
            lsample = rsample * (1 - t);
            rsample *= t;
          } else {
            lsample = 0;
          }

          // Delay is always done, since it does not need sound input
          if (k >= dly) {
            // Left channel = left + right[-p] * t
            lsample += chnBuf[k - dly + 1] * dlyAmt;

            // Right channel = right + left[-p] * t
            rsample += chnBuf[k - dly] * dlyAmt;
          }

          // Store in stereo channel buffer (needed for the delay effect)
          chnBuf[k] = lsample | 0;
          chnBuf[k + 1] = rsample | 0;

          // ...and add to stereo mix buffer
          this.mMixBuf[k] += lsample | 0;
          this.mMixBuf[k + 1] += rsample | 0;
        }
      }
    }

    // Next iteration. Return progress (1.0 == done!).
    this.mCurrentCol++;
    return this.mCurrentCol / this.mSong.numChannels;
  };

  public createWave = (): Uint8Array => {
    // Create WAVE header
    const headerLen = 44,
      l1 = headerLen + this.mNumWords * 2 - 8,
      l2 = l1 - 36,
      wave = new Uint8Array(headerLen + this.mNumWords * 2);
    wave.set([
      82,
      73,
      70,
      70,
      l1 & 255,
      (l1 >> 8) & 255,
      (l1 >> 16) & 255,
      (l1 >> 24) & 255,
      87,
      65,
      86,
      69,
      102,
      109,
      116,
      32,
      16,
      0,
      0,
      0,
      1,
      0,
      2,
      0,
      68,
      172,
      0,
      0,
      16,
      177,
      2,
      0,
      4,
      0,
      16,
      0,
      100,
      97,
      116,
      97,
      l2 & 255,
      (l2 >> 8) & 255,
      (l2 >> 16) & 255,
      (l2 >> 24) & 255,
    ]);

    // Append actual wave data
    for (let i = 0, idx = headerLen; i < this.mNumWords; ++i) {
      // Note: We clamp here
      let y = this.mMixBuf[i];
      y = y < -32767 ? -32767 : y > 32767 ? 32767 : y;
      wave[idx++] = y & 255;
      wave[idx++] = (y >> 8) & 255;
    }

    // Return the WAVE formatted typed array
    return wave;
  };

  private oscSin = (value): number => Math.sin(value * 6.283184);

  private oscSaw = (value): number => 2 * (value % 1) - 1;

  private oscSquare = (value): number => (value % 1 < 0.5 ? 1 : -1);

  private oscTri = (value): number => {
    const v2 = (value % 1) * 4;
    if (v2 < 2) return v2 - 1;
    return 3 - v2;
  };

  private mOscillators = [
    this.oscSin,
    this.oscSquare,
    this.oscSaw,
    this.oscTri,
  ];

  private getNoteFreq = (n): number => {
    // 174.61.. / 44100 = 0.003959503758 (F3)
    return 0.003959503758 * 2 ** ((n - 128) / 12);
  };

  private createNote = (instr, n, rowLen): Int32Array => {
    const osc1 = this.mOscillators[instr.i[0]],
      o1vol = instr.i[1],
      o1xenv = instr.i[3],
      osc2 = this.mOscillators[instr.i[4]],
      o2vol = instr.i[5],
      o2xenv = instr.i[8],
      noiseVol = instr.i[9],
      attack = instr.i[10] * instr.i[10] * 4,
      sustain = instr.i[11] * instr.i[11] * 4,
      release = instr.i[12] * instr.i[12] * 4,
      releaseInv = 1 / release,
      arpInterval = rowLen * 2 ** (2 - instr.i[14]);

    let arp = instr.i[13];

    const noteBuf = new Int32Array(attack + sustain + release);

    // Re-trig oscillators
    let c1 = 0,
      c2 = 0,
      // Local variables.
      e,
      j,
      j2,
      o1t,
      o2t,
      rsample,
      t;

    // Generate one note (attack + sustain + release)
    for (j = 0, j2 = 0; j < attack + sustain + release; j++, j2++) {
      if (j2 >= 0) {
        // Switch arpeggio note.
        arp = (arp >> 8) | ((arp & 255) << 4);
        j2 -= arpInterval;

        // Calculate note frequencies for the oscillators
        o1t = this.getNoteFreq(n + (arp & 15) + instr.i[2] - 128);
        o2t =
          this.getNoteFreq(n + (arp & 15) + instr.i[6] - 128) *
          (1 + 0.0008 * instr.i[7]);
      }

      // Envelope
      e = 1;
      if (j < attack) {
        e = j / attack;
      } else if (j >= attack + sustain) {
        e -= (j - attack - sustain) * releaseInv;
      }

      // Oscillator 1
      t = o1t;
      if (o1xenv) {
        t *= e * e;
      }
      c1 += t;
      rsample = osc1(c1) * o1vol;

      // Oscillator 2
      t = o2t;
      if (o2xenv) {
        t *= e * e;
      }
      c2 += t;
      rsample += osc2(c2) * o2vol;

      // Noise oscillator
      if (noiseVol) {
        rsample += (2 * Math.random() - 1) * noiseVol;
      }

      // Add to (mono) channel buffer
      noteBuf[j] = (80 * rsample * e) | 0;
    }

    return noteBuf;
  };
}
