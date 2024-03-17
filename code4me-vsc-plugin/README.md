## Code4Me

<!-- Plugin description -->
**AI code completion**, seamlessly integrated with IntelliSense. Manually trigger completions with `^Space`, and cycle with `^N` and `^P` for the next and previous completion.

The code suggestions from Code4Me are displayed with a unicode "&#10094;&#65295;&#10095;" representation of the logo. Code4Me does not hinder native auto completion or other extensions. For more information, visit the [Code4Me](https://code4me.me) website.
<!-- Plugin description end -->

### Goal
Code4Me exists for research purposes at the [Delft University of Technology](https://www.tudelft.nl/). Code4Me is a supportive tool to gather data about developers' interactions with code-completion LLMs. 

### Data Collection
The plugin does **not** collect identifiable data. The plugin does collect the following *anonymised* usage data: 

- Close context around the cursor. 
- The generated completion, and whether it was accepted. 
- Verified insertion.
  - The plugin tracks the line the code was inserted and sends that line to the server after a timeout.
- Time of completion.

Code4Me is in full compliance with the GDPR. The data collected will remain on the servers of TU Delft until the end of the study; and will not be published. By using Code4Me, you give permission for data collection. Thank you for supporting open-source research!
