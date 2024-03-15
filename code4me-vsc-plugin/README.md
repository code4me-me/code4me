# Code4Me

<!-- Plugin description -->
**Code4Me** provides AI-generated line completions, and is seamlessly integrated with VSCode's IntelliSense completions. You can also manually trigger completions using `⌃Space`. 

The code suggestions from Code4Me are denoted with a unicode "&#10094;&#65295;&#10095;" representation of the logo. Code4Me does not hinder native auto completion or other extensions. For more information, visit the [Code4Me](https://code4me.me) website.
<!-- Plugin description end -->

# Goal
Code4Me exists for research purposes at the [Delft University of Technology](https://www.tudelft.nl/). Code4Me is a supportive tool to gather data about auto-completion models and their usefulness. 

## Data Collection
The plugin does **not** collect identifiable data. The plugin does collect the following *anonymised* usage data: 

- Close context around the cursor. 
- The generated completion, and whether it was accepted. 
- Verified insertion.
  - The plugin tracks the line the code was inserted and sends that line to the server after a timeout.
- Time of completion.

Code4Me is in full compliance with the GDPR. The data collected will remain on the servers of TU Delft until the end of the study; and will not be published. By using Code4Me, you give permission for data collection. Thank you for supporting open-source research!

<!-- ### Optional Data Collection -->
<!-- To perform a failure analysis & improve code4me, we would like to store the close context before completions. This, however, is an **optional** setting and is turned off by default. We do not store the context around completions without explicit approval. This request is prompted upon start-up. -->

<!-- # Transmitted Code
To allow for code suggestions code (3992 characters left and right of trigger position) is send to servers at the TU Delft and processed. In return a code completion is send back.  -->