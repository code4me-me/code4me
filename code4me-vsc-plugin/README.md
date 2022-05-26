# Code4Me - VSC Extension

<!-- Plugin description -->
**Code4Me** provides language model based code completion. Code4Me predicts statement (line) completion and is seemlessly integrated with Visual Studio Code's code completion. The code suggestions from Code4Me are denoted with a unicode "&#10094;&#65295;&#10095;" representation of the logo. Code for me can be triggers automatically and can be prompted manually by pressing the keybind for autocompletion.

Code4Me does not hinder native auto completion or other extensions. For more information, visit the [Code4Me](https://code4me.me) website.
<!-- Plugin description end -->

# Goal
Code4Me is made by bachelor students at [Delft University of Technology](https://www.tudelft.nl/). Code4Me is a supportive tool to gather data about auto-completion models and their usefulness. This data is then analysed and discussed in a BSc thesis.

## Data Collection
The plugin does **not** collect personal data. The plugin does collect the following data:

* Suggest insertion.
* Verified insertion.
  - The plugin tracks the line the code was inserted and sends that line to the server after a timeout.
* Time of completion.

Code4Me is in full compliance with the GDPR and all data is anonymous. The data collected will remain on the servers of TU Delft until the end of the bachelor thesis. By using Code4Me you give permission for data collection. 

# Transmitted Code
To allow for code suggestions code (2048 characters left and right of trigger position) is send to servers at the TU Delft and processed. In return a code completion is send back. The sent code is not saved on the database.