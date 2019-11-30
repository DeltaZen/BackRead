import { GameSceneManager } from "./GameSceneManager";
import { Scene } from "../enum/Scene";
import { GameHtmlElement } from "./GameHtmlElement";

export class GameMenu {
  private static cellCount = GameHtmlElement.menuCarousel.children.length;
  private static selectedIndex = 0;

  static initialize(): void {
    GameHtmlElement.previousButton.addEventListener("click", () => {
      this.selectedIndex--;
      this.rotate();
    });

    GameHtmlElement.nextButton.addEventListener("click", () => {
      this.selectedIndex++;
      this.rotate();
    });

    Array.from(GameHtmlElement.menuCarousel.children).forEach(
      (menuOption: HTMLDivElement) => {
        menuOption.addEventListener("click", () => {
          GameSceneManager.displayScene(menuOption.dataset["option"] as Scene);
        });
      }
    );
  }

  private static rotate(): void {
    const angle = (this.selectedIndex / this.cellCount) * -360;
    GameHtmlElement.menuCarousel.style.transform = "rotateY(" + angle + "deg)";
  }
}
