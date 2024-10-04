# Tauri + Vue 3

This template should help get you started developing with Tauri + Vue 3 in Vite. The template uses Vue 3 `<script setup>` SFCs, check out the [script setup docs](https://v3.vuejs.org/api/sfc-script-setup.html#sfc-script-setup) to learn more.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)


## Example prompts

Create a simple pong game with two dark orange paddles and a dark orange ball. Before starting the game, diaplay a welcome message with a brief game description for 10 seconds, also showing a description of what keys to press to play the game.  At the bottom of the screen, display what controls to use to play the game, and also display how many times the player died. The game ends when Esc-key is pressed. The game is restarted when r-key is pressed.

Create a simple tetris game. Before starting the game, diaplay a welcome message with a brief game description for 5 seconds, also showing a description of what keys to press to play the game.  At the bottom of the screen, display what controls to use to play the game, and also display the score the player has, how many lives the player has left, etc. The game ends when Esc-key is pressed. The game is restarted when R-key is pressed.

Create a simple tetris game of falling dark orange blocks that need to be placed in a row to clear a line. Before starting the game, diaplay a welcome message with a brief game description for 5 seconds, also showing a description of what keys to press to play the game.  At the bottom of the screen, display what controls to use to play the game, and also display the score the player has, how many lives the player has left, etc. The game ends when Esc-key is pressed. The game is restarted when R-key is pressed.

Create a simple tetris game of falling dark orange blocks that need to be placed in a row to clear a line. Before starting the game, display a welcome message with a brief game description for 5 seconds, also showing a description of what keys to press to play the game. Use transparent background. At the bottom of the screen, display what controls to use to play the game, and also display the score the player has, how many lives the player has left, etc. The game ends when Q-key is pressed. The game is paused when the P-key is pressed. The game is restarted when R-key is pressed.


# Configuring iOS support

    ```bash
    # Check ruby version. Must be >2.6.0
    ruby -v

    (brew install ruby) - did not work as expected, got error that cocoapod was not installed
    brew install cocoapods

    # Add ruby to path. Force brew ruby to be first in path, overriding system ruby
    brew link --overwrite ruby --force

    # Install cocoapods
    sudo gem install cocoapods

    # Upgrade RubyGems
    sudo gem update --system 3.5.20


    yarn tauri ios init
    yarn tauri ios build

    # Got error:
    # xcodebuild: error: Found no destinations for the scheme 'gaimer_iOS' and action build
    # 1.  In Xcode, from the menu bar, choose Xcode > Settings….
    # 2.  Go to the Platforms tab.
    # 3a. If you see iOS v17.4, install it.
    # 3b. Otherwise, click the plus symbol (+) in the lower left corner, and then select iOS to view a list of its available versions.
    # 4.  Select iOS v17.4 and click Download & Install.
    ```
