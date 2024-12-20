import { tokens } from "typed-inject";
import { GameTopBar } from "./GameTopBar";
import { SoundBoxPlayer } from "./SoundBoxPlayer";

export class GameAudio {
  public static inject = tokens("gameTopBar");

  constructor(private gameTopBar: GameTopBar) {}

  public create(
    song: unknown,
    volume = 1.0,
    autoplay = false,
    loop = false,
  ): HTMLAudioElement {
    const audio = document.createElement("audio");
    audio.volume = volume;
    audio.autoplay = autoplay;
    audio.loop = loop;
    audio.muted = this.gameTopBar.isAudioDisabled();

    const player = new SoundBoxPlayer(song),
      progressChecker = setInterval(() => {
        if (player.generate() >= 1) {
          clearInterval(progressChecker);
          const wave = player.createWave();
          audio.src = URL.createObjectURL(
            new Blob([wave], { type: "audio/wav" }),
          );
        }
      }, 300);

    this.gameTopBar.onAudioMuteChanged.addListener((muted: boolean) => {
      audio.muted = muted;
    });

    return audio;
  }
}
