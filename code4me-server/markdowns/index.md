# Code4Me
**Code4Me** is a plugin that autocompletes code in a TU Delft research project for the CSE3000 course given in the Computer Science and Engineering bachelor.
This study focuses on the usefulness of various statement completion language models in a real-world setting.

The plugin autocompletes on trigger characters, and a keybind which will trigger the autocompletion wherever you want.

## Installation
We have developed IDE plugins for the following two major IDEs:

### JetBrains
The Code4Me plugin can be found in the [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/19200-code4me).

### VSC
TODO

## Data Collection
The plugin works with a remote API, which requires us to send (parts) of the currently opened file to our backend server, in order to suggest autocompletions.
However, we do **not** store any of this information server-side, it is purely used for generating an autocompletion, and calculating metrics like RougeL, BLEU score and METEOR.
These metrics output a numeral score, so server-side not even the completion by the model will be stored.

## Source Code
The source code for the IDE plugins and the API webserver can be found at our GitHub [repository](https://github.com/FrankHeijden/code-completion-plugin).
