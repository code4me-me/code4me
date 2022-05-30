# Code4Me
Code4Me provides automatic intelligent code completion based on large pre-trained language models. Code4Me predicts statement (line) completion and is available for both PyCharm (also other JetBrains IDEs) and Visual Studio Code. The code suggestions from Code4Me can be recognised by the logo in the suggestion menu. Code4Me automatically triggers (on specific trigger characters) or the user can prompt it manually by pressing the keybind. The keybind differs per IDE:

- Jetbrains: **ALT + SHIFT + K**
- VSC: **CTRL + SPACE**

Code4Me does not hinder native auto completion or other extensions.

## Installation
The plugin is available on both marketplaces. You can download them by either clicking the link in your browser or looking up 'Code4Me' in the integrated marketplace of your IDE.

### JetBrains
The Code4Me plugin can be found in the [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/19200-code4me).

### VSC
The Code4Me plugin can be found in the [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Code4Me.code4me-plugin).

## Data Collection
The plugin works with a remote API in order to suggest autocompletions. After triggering the autocompletion (automatically or manually), the client's request is sent to the server. Running the ML-based model, the server returns a prediction in response to the client. The remote API requires a segment of the current document (close left context at the trigger point). This limited segment is sent to the backend server only for prediction and will not be stored on our server. 
For the purpose of evaluating the models' predictions, we only store the suggestion made by the ML-based models at each trigger point and compare it against the accepted prediction by users (collected after 30 seconds). 

The plugin does not collect personal data nor the segment sent. The plugin does collect the following data:

* Suggested autocompletion.
* Verification of the autocompletion.
  * The plugin tracks the line the code was inserted and sends that line to the server after 30 seconds.
* Inference time of completion.

Furthermore, Code4Me is in full compliance with the GDPR and all data is anonymous. The data collected will remain on the servers of TU Delft until the end of the study. By using Code4Me you give permission for the data collection.

## Source Code
The source code for the IDE plugins and the API webserver can be found at our GitHub [repository](https://github.com/code4me-me/code4me).