import * as vscode from 'vscode';
import rand from 'csprng';
import fetch from 'node-fetch';
import * as path from 'path';

const DATA_STORAGE_WINDOW_REQUEST_TEXT = `
Code4Me exists for research purposes – we'd like to 
study the code context around completions. The data 
is stored anonymously and removed after 3 months. `
const DATA_STORAGE_OPT_IN     = "Agree";
const DATA_STORAGE_REMIND_ME  = "Remind Me";
const DATA_STORAGE_OPT_OUT    = "Opt Out";
const DATA_STORAGE_READ_MORE  = "Read more";

const INFORMATION_WINDOW_CLOSE = "Close";
const MAX_REQUEST_WINDOW_CLOSE_1_HOUR = "Close for 1 hour";
const INFORMATION_WINDOW_DONT_SHOW_AGAIN = "Don't show again";
const SURVEY_WINDOW_REQUEST_TEXT = "Do you mind filling in a quick survey about Code4Me?";
const SURVEY_WINDOW_SURVEY = "Survey";

const AVERAGE_TOKEN_LENGHT_IN_CHARACTERS = 7984;

const CODE4ME_EXTENSION_ID = 'Code4Me.code4me-plugin';

const allowedTriggerCharacters = ['.', '+', '-', '*', '/', '%', '<', '>', '**', '<<', '>>', '&', '|', '^', '+=', '-=', '==', '!=', ';', ',', '[', '(', '{', '~', '=', '<=', '>='];
const allowedTriggerWords = ['await', 'assert', 'raise', 'del', 'lambda', 'yield', 'return', 'while', 'for', 'if', 'elif', 'else', 'global', 'in', 'and', 'not', 'or', 'is', 'with', 'except'];

// const configuration = vscode.workspace.getConfiguration('code4me', undefined);
// let promptMaxRequestWindow = true;


export function activate(context: vscode.ExtensionContext) {

  if (!context.globalState.get('code4me-uuid')) {
    context.globalState.update('code4me-uuid', rand(128, 16));
  }

  start(context).then(disposable => {
    context.subscriptions.push(disposable);
  })
  console.log('Code4me Activated !')
}

/** Create a new CompletionItemProvider on startup or when config changes */
async function start(context: vscode.ExtensionContext) {

  const disposables: vscode.Disposable[] = [];

  let completionItemProvider : vscode.Disposable | null = null 
  disposables.push({dispose: () => completionItemProvider?.dispose() })

  async function setupCompletions(): Promise<void> {

    let config = vscode.workspace.getConfiguration('code4me')
    if (config.get('promptDataStorage')) { doPromptDataStorageMenu(config) }

    if (completionItemProvider !== null) {
      console.log('existing completion provider found, resetting')
      completionItemProvider.dispose()
    }
    completionItemProvider = await createCompletionItemProvider(context, config)
    console.log('autocomplete enabled')
  }
  setupCompletions() 

  disposables.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('code4me')) { setupCompletions() }
    }), 
    vscode.commands.registerCommand('code4me.helloWorld', () => {
      vscode.window.showInformationMessage('Hello from Code4Me!')
    })
  );

  return vscode.Disposable.from(...disposables)
}

async function createCompletionItemProvider(
  context: vscode.ExtensionContext, 
  config: vscode.WorkspaceConfiguration
): Promise<vscode.Disposable> {

  const disposables: vscode.Disposable[] = [] 
  // TODO: create an async function to retrieve language-specific settings. 
  const languageFilters = { pattern: '**' }
  const uuid : string = context.globalState.get('code4me-uuid')!;

  disposables.push(
    vscode.languages.registerCompletionItemProvider(
      languageFilters, new CompletionItemProvider(uuid, config), ...allowedTriggerCharacters
    )
  )

  return { dispose: () => { disposables.forEach(d => d.dispose()) } }
}


// // NOTE: this is straight up wrong, leads to an undisposable extension. 
// // I don't know how this even got accepted into the VSC marketplace. 

// export function activate(extensionContext: ExtensionContext) {
//   if (!extensionContext.globalState.get('code4me-uuid')) {
//     extensionContext.globalState.update('code4me-uuid', rand(128, 16));
//   }

//   if (configuration.get('promptDataStorage')) doPromptDataStorageMenu();

//   const code4MeUuid: string = extensionContext.globalState.get('code4me-uuid')!;

//   extensionContext.subscriptions.push(vscode.commands.registerCommand('verifyInsertion', verifyInsertion));
//   extensionContext.subscriptions.push(
//     vscode.languages.registerCompletionItemProvider({ pattern: '**' }, 
//     {
//       async provideCompletionItems(document, position, token, context) {
//         const jsonResponse = await callToAPIAndRetrieve(document, position, code4MeUuid, context.triggerKind);
//         if (!jsonResponse) return undefined;

//         const listPredictionItems = jsonResponse.predictions;

//         if (listPredictionItems.length == 0) return undefined;
//         const completionToken = jsonResponse.verifyToken;

//         const promptSurvey = configuration.get("code4me.promptSurvey");
//         if (jsonResponse.survey && promptSurvey) doPromptSurvey(code4MeUuid);


//         const timer = verifyInsertion(position, null, completionToken, code4MeUuid, null);
//         return listPredictionItems.map((prediction: string) => {
//           const completionItem = new vscode.CompletionItem('\u276E\uff0f\u276f: ' + prediction);
//           completionItem.sortText = '0.0000';
//           if (prediction == "") return undefined;
//           completionItem.insertText = prediction;

//           const positionFromCompletionToEndOfLine = new vscode.Position(position.line, document.lineAt(position.line).range.end.character);
//           const positionPlusOne = new vscode.Position(position.line, position.character + 1);
//           const charactersAfterCursor = document.getText(new vscode.Range(position, positionFromCompletionToEndOfLine));
//           const characterAfterCursor = charactersAfterCursor.charAt(0);

//           const lastTwoCharacterOfPrediction = prediction.slice(-2);
//           const lastCharacterOfPrediction = prediction.slice(-1);

//           if (lastTwoCharacterOfPrediction === '):' || lastTwoCharacterOfPrediction === ');' || lastTwoCharacterOfPrediction === '),') {
//             completionItem.range = new vscode.Range(position, positionFromCompletionToEndOfLine);
//           } else if (characterAfterCursor === lastCharacterOfPrediction) {
//             completionItem.range = new vscode.Range(position, positionPlusOne);
//           }

//           completionItem.command = {
//             command: 'verifyInsertion',
//             title: 'Verify Insertion',
//             arguments: [position, prediction, completionToken, code4MeUuid, timer]
//           };
//           return completionItem;
//         });
//       }
//     }, 
//     ' ', '.', '+', '-', '*', '/', '%', '*', '<', '>', '&', '|', '^', '=', '!', ';', ',', '[', '(', '{', '~')
//   );
//   extensionContext.subscriptions.push(
//     vscode.languages.registerCompletionItemProvider({ language: '*' }, 
//     new InlineCompletionItemProvider(), 
//     ' ', '.', '+', '-', '*', '/', '%', '*', '<', '>', '&', '|', '^', '=', '!', ';', ',', '[', '(', '{', '~')
//   );
// }



// function showMaxRequestWindow(displayedText: string) {
//   if (!promptMaxRequestWindow) return;
//   vscode.window.showInformationMessage(
//     displayedText,
//     INFORMATION_WINDOW_CLOSE,
//     MAX_REQUEST_WINDOW_CLOSE_1_HOUR,
//     INFORMATION_WINDOW_DONT_SHOW_AGAIN
//   ).then(selection => {
//     if (selection === MAX_REQUEST_WINDOW_CLOSE_1_HOUR) {
//       promptMaxRequestWindow = false;
//       setTimeout(() => {
//         promptMaxRequestWindow = true;
//       }, 3600 * 1000);
//     }
//     if (selection === INFORMATION_WINDOW_DONT_SHOW_AGAIN) {
//       promptMaxRequestWindow = false;
//     }
//   });
// }

// function showErrorWindow(text: string) {
//   vscode.window.showInformationMessage(text);
// }

// function getTriggerCharacter(document: vscode.TextDocument, position: vscode.Position, length: number) {
//   const endPos = new vscode.Position(position.line, position.character);
//   if (position.character - length < 0) return undefined;
//   const startCharacterPos = new vscode.Position(position.line, position.character - length);
//   const rangeCharacter = new vscode.Range(startCharacterPos, endPos);
//   const character = document.getText(rangeCharacter);
//   return character.trim();
// }

// /**
//  * Returns the trigger character used for the completion.
//  * @param document the document the completion was triggered.
//  * @param position the current position of the cursor.
//  * @returns triggerCharacter string or null (manual trigger suggest) or undefined if no trigger character was found.
//  */
// function determineTriggerCharacter(document: vscode.TextDocument, position: vscode.Position, triggerKind: vscode.CompletionTriggerKind): string | null | undefined {
//   const singleTriggerCharacter = getTriggerCharacter(document, position, 1);
//   const doubleTriggerCharacter = getTriggerCharacter(document, position, 2);
//   const tripleTriggerCharacter = getTriggerCharacter(document, position, 3);

//   const startPosLine = new vscode.Position(position.line, 0);
//   const endPosLine = new vscode.Position(position.line, position.character);
//   const rangeLine = new vscode.Range(startPosLine, endPosLine);

//   const lineSplit = document.getText(rangeLine).trim().split(/[ ]+/g);
//   const lastWord = lineSplit != null ? lineSplit.pop()!.trim() : "";

//   // There are 3 kinds of triggers: Invoke = 0, triggerCharacter = 1, IncompleteItems = 2.
//   // Invoke always triggers on 24/7 completion (any character typed at start of word) and
//   // whenever there is a manual call to triggerSuggest. By cancelling out the 24/7 completion
//   // for Code4Me, we can detect a manual trigger.
//   if (triggerKind === vscode.CompletionTriggerKind.Invoke) {
//     // Manual completion on empty line.
//     if (lastWord.length === 0) return null;
//     // Likely start of word and triggered on 24/7 completion, do not autocomplete.
//     else if (lastWord.length === 1 && lastWord.match(/[A-z]+/g)) return undefined;
//     // Likely start of word and triggered on trigger characters, return trigger character as if trigger completion.
//     else if (lastWord.slice(lastWord.length - 1).match(/[^A-z]+/g)) return determineTriggerCharacter(document, position, vscode.CompletionTriggerKind.TriggerCharacter);
//     // Return found trigger word.
//     else return lastWord;
//   } else { // TriggerKind = 1, trigger completion
//     if (allowedTriggerWords.includes(lastWord)) return lastWord;
//     else if (tripleTriggerCharacter && allowedTriggerCharacters.includes(tripleTriggerCharacter)) return tripleTriggerCharacter;
//     else if (doubleTriggerCharacter && allowedTriggerCharacters.includes(doubleTriggerCharacter)) return doubleTriggerCharacter;
//     else if (singleTriggerCharacter && allowedTriggerCharacters.includes(singleTriggerCharacter)) return singleTriggerCharacter;
//     else return undefined;
//   }
// }

// /**
//  * 
//  * @param nCharacters the amount of characters taken left and right of the cursor.
//  * @param position the cursor position.
//  * @returns an array with index 0 the left text and index 1 the right text. Empty strings if text editor cannot be found.
//  */
// function splitTextAtCursor(nCharacters: number, position: vscode.Position): string[] {
//   const editor = vscode.window.activeTextEditor;
//   if (!editor) return ['', ''];
//   const document = editor.document;
//   const documentLineCount = document.lineCount - 1;
//   const lastLine = document.lineAt(documentLineCount);
//   const beginDocumentPosition = new vscode.Position(0, 0);
//   const leftRange = new vscode.Range(beginDocumentPosition, position);

//   const lastLineCharacterOffset = lastLine.range.end.character;
//   const lastLineLineOffset = lastLine.lineNumber;
//   const endDocumentPosition = new vscode.Position(lastLineLineOffset, lastLineCharacterOffset);
//   const rightRange = new vscode.Range(position, endDocumentPosition);

//   const leftText = editor.document.getText(leftRange);
//   const rightText = editor.document.getText(rightRange);

//   return [leftText.substring(-nCharacters), rightText.substring(0, nCharacters)];
// }

// async function callToAPIAndRetrieve(document: vscode.TextDocument, position: vscode.Position, code4MeUuid: string, triggerKind: vscode.CompletionTriggerKind): Promise<any | undefined> {
//   const textArray = splitTextAtCursor(AVERAGE_TOKEN_LENGHT_IN_CHARACTERS, position);
//   const triggerPoint = determineTriggerCharacter(document, position, triggerKind);
//   if (triggerPoint === undefined) return undefined;
//   const textLeft = textArray[0];
//   const textRight = textArray[1];

//   const configuration = vscode.workspace.getConfiguration('code4me', undefined);
  
//   try {
//     const url = "https://code4me.me/api/v1/prediction/autocomplete";
//     const response = await fetch(url, {
//       method: "POST",
//       body: JSON.stringify(
//         {
//           "leftContext": textLeft,
//           "rightContext": textRight,
//           "triggerPoint": triggerPoint,
//           "language": document.fileName.split('.').pop(),
//           "ide": "vsc",
//           "keybind": triggerKind === vscode.CompletionTriggerKind.Invoke,
//           "pluginVersion": vscode.extensions.getExtension(CODE4ME_EXTENSION_ID)?.packageJSON['version'],
//           "storeContext": configuration.get('storeContext')
//         }
//       ),
//       headers: {
//         'Content-Type': 'application/json',
//         'Authorization': 'Bearer ' + code4MeUuid
//       }
//     });

//     if (!response.ok) {
//       if (response.status == 429) {
//         showMaxRequestWindow("You have exceeded the limit of 1000 suggestions per hour.");
//       }
//       console.error("Response status not OK! Status: ", response.status);
//       return undefined;
//     }

//     const contentType = response.headers.get('content-type');
//     if (!contentType || !contentType.includes('application/json')) {
//       console.error("Wrong content type!");
//       return undefined;
//     }

//     const json = await response.json();

//     if (!Object.prototype.hasOwnProperty.call(json, 'predictions')) {
//       console.error("Predictions field not found in response!");
//       return undefined;
//     }
//     if (!Object.prototype.hasOwnProperty.call(json, 'verifyToken')) {
//       console.error("VerifyToken field not found in response!");
//       return undefined;
//     }
//     if (!Object.prototype.hasOwnProperty.call(json, 'survey')) {
//       console.error("Survey field not found in response!");
//       return undefined;
//     }
//     return json;
//   } catch (e) {
//     console.error("Unexpected error: ", e);
//     showErrorWindow("Unexpected error: " + e);
//     return undefined;
//   }
// }

// // eslint-disable-next-line @typescript-eslint/no-empty-function
// export function deactivate() { }


// NOTE: Class used in user study to provide inline completion items. 
class CompletionItemProvider implements vscode.CompletionItemProvider {

  constructor(private uuid: string, private config: vscode.WorkspaceConfiguration) {}

  async callCompletionsAPI(document: vscode.TextDocument, position: vscode.Position, triggerKind: vscode.CompletionTriggerKind) {
    const response: JSON = JSON 
    // return response.predictions || []
    // Replace list below with json attribute
    let predictions: Array<string> = ['pred_new', 'pred_new_2', 'pred_old'] || []
    // Now we either HAVE a list of completions, or undefined/null maps to empty list
    predictions = predictions.filter((prediction: string) => prediction !== "");

    return {
      predictions: predictions || [],
      verifyToken: 'token' || null,
      survey: true || false
    }
  }

  async provideCompletionItems(
    document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext
  ): Promise<vscode.CompletionList | undefined>
  {
    const response = await this.callCompletionsAPI(document, position, context.triggerKind);
    
    if (response.predictions.length === 0) return undefined 

    const promptSurvey = this.config.get("code4me.promptSurvey");
    if (response.survey && promptSurvey) doPromptSurvey(this.uuid, this.config);

    const completionToken: string = response.verifyToken;
    const command: NodeJS.Timeout = verifyInsertion(position, null, completionToken, this.uuid, null);
    const completionItems :vscode.CompletionItem[] = response.predictions.map((prediction: string) => {
      return createCompletionItem(prediction, position, document, completionToken, this.uuid, command)
    })

    return new vscode.CompletionList(completionItems, false)
  }

  resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
    throw new Error('Method not implemented.');
  }

}

function createCompletionItem(
  prediction: string, position: vscode.Position, document: vscode.TextDocument, 
  completionToken: string, code4MeUuid: string, timer: NodeJS.Timeout | null
): vscode.CompletionItem
{
  // We filter them out earlier in callCompletionsAPI, to have more type-safe logic 
  // if (prediction == "") return undefined;

  const item = new vscode.CompletionItem(
    prediction, 
    vscode.CompletionItemKind.EnumMember // I chose this because it's less common than 'Property' 
  )
  item.insertText = prediction  // No longer necessary as 'detail' now contains the logo
  item.filterText = prediction  // The culprit of why suggestions were ranked at the bottom
  item.sortText = '0' // Force sort at the top always (when compared with other identical prefixes)
  item.detail = '\u276E\uff0f\u276f' // Logo 

  // TODO: in the future, it could be nice to show to users which model generated 
  // this suggestion. And, maybe even summarise with another LLM
  item.documentation = 'Code4Me Completion' 

  const positionFromCompletionToEndOfLine = new vscode.Position(position.line, document.lineAt(position.line).range.end.character);
  const positionPlusOne = new vscode.Position(position.line, position.character + 1);
  const charactersAfterCursor = document.getText(new vscode.Range(position, positionFromCompletionToEndOfLine));
  const characterAfterCursor = charactersAfterCursor.charAt(0);

  const lastTwoCharacterOfPrediction = prediction.slice(-2);
  const lastCharacterOfPrediction = prediction.slice(-1);

  if (lastTwoCharacterOfPrediction === '):' || lastTwoCharacterOfPrediction === ');' || lastTwoCharacterOfPrediction === '),') {
    item.range = new vscode.Range(position, positionFromCompletionToEndOfLine);
  } else if (characterAfterCursor === lastCharacterOfPrediction) {
    item.range = new vscode.Range(position, positionPlusOne);
  }

  item.command = {
    command: 'verifyInsertion',
    title: 'Verify Insertion',
    arguments: [position, prediction, completionToken, code4MeUuid, timer]
  };
  return item;
}

function verifyInsertion(position: vscode.Position, completion: string | null, completionToken: string, apiKey: string, timer: NodeJS.Timeout | null) {
  if (timer !== null) clearTimeout(timer);
  const editor = vscode.window.activeTextEditor;
  const document = editor!.document;
  const documentName = document.fileName;
  let lineNumber = position.line;
  const originalOffset = position.character;
  let characterOffset = originalOffset;

  const listener = vscode.workspace.onDidChangeTextDocument(event => {
    if (vscode.window.activeTextEditor == undefined) return;
    if (vscode.window.activeTextEditor.document.fileName !== documentName) return;
    for (const changes of event.contentChanges) {
      const text = changes.text;
      const startChangedLineNumber = changes.range.start.line;
      const endChangedLineNumber = changes.range.end.line;

      if (startChangedLineNumber == lineNumber - 1 && endChangedLineNumber == lineNumber && changes.text == '') {
        lineNumber--;
        const startLine = document.lineAt(startChangedLineNumber);
        if (startLine.isEmptyOrWhitespace) characterOffset++;
        else characterOffset += changes.range.start.character + 1;
      }

      if (startChangedLineNumber == lineNumber) {
        if (changes.range.end.character < characterOffset + 1) {
          if (changes.text === '') {
            characterOffset -= changes.rangeLength;
          } if (changes.text.includes('\n')) {
            characterOffset = originalOffset;
            lineNumber += (text.match(/\n/g) ?? []).length;
          } else {
            characterOffset += changes.text.length;
          }
        }
      } else if (lineNumber == 0 || startChangedLineNumber < lineNumber) {
        lineNumber += (text.match(/\n/g) ?? []).length;
      }

      if (changes.range.end.line <= lineNumber) {
        if (changes.text === '') {
          lineNumber -= changes.range.end.line - startChangedLineNumber;
        }
      }
    }
  });


  return timer = setTimeout(async () => {
    listener.dispose();
    const lineText = editor?.document.lineAt(lineNumber).text;
    const response = await fetch("https://code4me.me/api/v1/prediction/verify", {
      method: 'POST',
      body: JSON.stringify(
        {
          "verifyToken": completionToken,
          "chosenPrediction": completion,
          "groundTruth": lineText?.substring(characterOffset).trim()
        }
      ),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      }
    });

    if (!response.ok) {
      console.error("Response status not OK! Status: ", response.status);
      return undefined;
    }
  }, 30000);
}

function doPromptDataStorageMenu(config: vscode.WorkspaceConfiguration) {
  vscode.window.showInformationMessage(
    DATA_STORAGE_WINDOW_REQUEST_TEXT,
    DATA_STORAGE_OPT_IN,
    DATA_STORAGE_REMIND_ME,
    DATA_STORAGE_OPT_OUT,
    DATA_STORAGE_READ_MORE
  ).then(selection => {
    const url = `https://code4me.me/`;

    switch (selection) {
      case DATA_STORAGE_OPT_IN:
        config.update('storeContext', true, true);
        config.update('promptDataStorage', false, true);
        break;
      case DATA_STORAGE_OPT_OUT:
        config.update('promptDataStorage', false, true);
        break;
      case DATA_STORAGE_READ_MORE:
        vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url));
        vscode.commands.executeCommand("workbench.action.openSettings", "code4me.storeContext");
        config.update('promptDataStorage', false, true);
        break;
      default:
        break;
    }
  });
}

function doPromptSurvey(uuid: string, config: vscode.WorkspaceConfiguration) {
  vscode.window.showInformationMessage(
    SURVEY_WINDOW_REQUEST_TEXT,
    SURVEY_WINDOW_SURVEY,
    INFORMATION_WINDOW_CLOSE,
    INFORMATION_WINDOW_DONT_SHOW_AGAIN
  ).then(selection => {
    if (selection === SURVEY_WINDOW_SURVEY) {
      const url = `https://code4me.me/api/v1/survey?user_id=${uuid}`;
      vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url));
    }
    if (selection === INFORMATION_WINDOW_DONT_SHOW_AGAIN) {
      config.update('promptSurvey', false, true);
    }
  });
}