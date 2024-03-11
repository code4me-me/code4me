import * as vscode from 'vscode';
import rand from 'csprng';
import fetch, { Response } from 'node-fetch';
import * as path from 'path';

// After how many ms the completion is manually triggered if the user is idle. 
const IDLE_TRIGGER_DELAY_MS = 3000; 
// After how many ms the automatic completion is sent to the server.
// I know this is suboptimal, but otherwise it's literally on almost every keystroke. 
// For reference, Copilot (2022 version) uses 75ms 
const AUTO_DEBOUNCE_DELAY_MS = 300;
// After how many ms to return the ground truth 
const GROUND_TRUTH_DELAY_MS = 10000;

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

const AVG_TOKEN_LENGTH_IN_CHARS = 7984;

const CODE4ME_EXTENSION_ID = 'Code4Me.code4me-plugin';

// const allowedTriggerCharacters = ['.', '+', '-', '*', '/', '%', '<', '>', '**', '<<', '>>', '&', '|', '^', '+=', '-=', '==', '!=', ';', ',', '[', '(', '{', '~', '=', '<=', '>='];

// const allowedTriggerCharacters = Array.from({length: 128}, (_, i) => String.fromCharCode(i));
// The above, but only including visible characters 
// const allowedTriggerCharacters = Array.from({length: 95}, (_, i) => String.fromCharCode(i + 32));
const allowedTriggerWords = ['await', 'assert', 'raise', 'del', 'lambda', 'yield', 'return', 'while', 'for', 'if', 'elif', 'else', 'global', 'in', 'and', 'not', 'or', 'is', 'with', 'except'];

// NOTE: extremely bad practice to put state at the top here, as 
// it is 1. not clear what it's for; 2. not disposed of properly when extension is deactivated
let promptMaxRequestWindow = true;
let sessionCompletions = 0;
let responseflakiness = true;  // for testing, check what happens if responses are flaky

// Enum for triggers: manual, timeout, or automatic 
// TODO: Is this really how typed enums work in TS? 
// Like, what the hell does the T in TS even stand for?
type TriggerType = 'manual' | 'idle' | 'auto' // auto refers to the default value here.


export function activate(context: vscode.ExtensionContext) {

  if (!context.globalState.get('code4me-uuid')) {
    context.globalState.update('code4me-uuid', rand(128, 16));
  }

  start(context).then(disposable => {
    context.subscriptions.push(disposable);
    console.log('Code4me Activated !')
  })
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() { }

/** Create a new CompletionItemProvider on startup or when config changes */
async function start(context: vscode.ExtensionContext) {

  const disposables: vscode.Disposable[] = [];

  let completionItemProvider : vscode.Disposable | null = null 
  disposables.push({dispose: () => completionItemProvider?.dispose() })

  async function setupCompletions(): Promise<void> {

    let config = vscode.workspace.getConfiguration('code4me')
    if (config.get('promptDataStorage')) { doPromptDataStorageMenu(config) }

    if (completionItemProvider !== null) {
      console.log('existing code4me completion provider found, resetting')
      completionItemProvider.dispose()
    }
    completionItemProvider = await createCompletionItemProvider(context, config)
    console.log('code4me completions enabled')
  }
  setupCompletions() 

  disposables.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('code4me')) { setupCompletions() }
    }), 
    vscode.commands.registerCommand('code4me.helloWorld', () => {
      vscode.window.showInformationMessage('Hello from Code4Me!')
    }),
  );

  return vscode.Disposable.from(...disposables)
}

async function createCompletionItemProvider(
  context: vscode.ExtensionContext, 
  config: vscode.WorkspaceConfiguration
): Promise<vscode.Disposable> {

  const disposables: vscode.Disposable[] = [] 

  // TODO: create an async function to retrieve language-specific settings, 
  // and add to disposables. 
  const languageFilters = { pattern: '**' }
  const uuid : string = context.globalState.get('code4me-uuid')!;
  console.log('uuid', uuid)
  const completionItemProvider = new CompletionItemProvider(uuid, config)

  disposables.push(
    // This is the only way I could figure out how to check for manual triggers. 
    // Override the keybind for vscode.actions.triggerSuggest (see package.json > keybinds)
    // As a result, vscode triggerSuggest is not called (still exists in the command palette)
    // Then, we can modify the completionItemProvider.manual property to true, 
    // and then execute the built-in triggerSuggest command
    vscode.commands.registerCommand('code4me.action.triggerSuggest', () => {
      completionItemProvider.trigger = 'manual'; 
      vscode.commands.executeCommand('editor.action.triggerSuggest')
    }),
    // Timeout trigger
    vscode.workspace.onDidChangeTextDocument(() => { completionItemProvider.setIdleTrigger() }),
    // Actual completions provider (+ handles automatic triggers)
    vscode.languages.registerCompletionItemProvider(
      languageFilters, completionItemProvider
    ), 
    vscode.commands.registerCommand('verifyInsertion', verifyInsertion)
  )

  return { dispose: () => { disposables.forEach(d => d.dispose()) } }
}

// NOTE: Class used in user study to provide inline completion items.
// Honestly, I'm biased but would strongly consider using this instead 
// of the previous code, as I fixed a few serious bugs  

/** Completion Item Provider, impl 2 methods: 
 * 1. provideCompletionItems: generates a list of completions
 * 2. resolveCompletionItems: used in case the list is incomplete (i.e. lazy loading), not used here. 
 * 
 * Method 1 uses `callCompletionsAPI` to fetch completions from the server,
 * and then maps the response to a list of `vscode.CompletionItem` objects.
 */
class CompletionItemProvider implements vscode.CompletionItemProvider {

  constructor(private uuid: string, private config: vscode.WorkspaceConfiguration) {}

  trigger: TriggerType = 'auto'
  idleTimer: NodeJS.Timeout | undefined = undefined // triggered after the user is idle for a while
  autoTimer: NodeJS.Timeout | undefined = undefined // Debounce automatic requests

  predictionCache: vscode.CompletionList = new vscode.CompletionList([], true)


  /** Interface method for providing a (optionally preliminary) set of completions */
  async provideCompletionItems(
    document: vscode.TextDocument, 
    position: vscode.Position, 
    token: vscode.CancellationToken, 
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionList>
  {
    // And, behold, why switch statements are actually not that great 
    switch (this.trigger) {

      // Timeout invocations will already have called the completion API, so we return the cache
      case 'idle':
        this.trigger = 'auto'
        clearTimeout(this.idleTimer) // not really necessary here, but will fail silently 
        return this.predictionCache 

      // Manual invocations always call the API, with a leading debounce 
      case 'manual':  
        this.trigger = 'auto'
        clearTimeout(this.idleTimer)
        return this.callPredictionsAPI(document, position, 'manual')

      // Automatic invocations have a trailing debounce 
      // (i.e. call once the user stops typing x ms)
      default: 
      // These five lines took me a day to write 
        return await new Promise(resolve => {
          clearTimeout(this.autoTimer)
          this.autoTimer = setTimeout(async () => {
            this.predictionCache = await this.callPredictionsAPI(document, position, 'auto')
            clearTimeout(this.idleTimer)
            resolve(this.predictionCache)
          }, AUTO_DEBOUNCE_DELAY_MS)
        })
    }
  }

  /** Interface method for updating completion items with additional information  */
  resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
    throw new Error('Method not implemented.');
  }
  
  /** Automatically invoke triggerSuggest if user is idle for `IDLE_TRIGGER_DELAY_MS` */
  async setIdleTrigger() {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(async () => {
      
      if (await this.cachePredictions('idle')) {
        this.trigger = 'idle'  
        await vscode.commands.executeCommand('editor.action.triggerSuggest')
      }
    }, IDLE_TRIGGER_DELAY_MS)
  }

  /** Cache completions for the timeout trigger.
   * This makes sure the timeout only calls `editor.action.triggerSuggest` iff there are completions. 
   * Returns true if predictions were received and cached; false otherwise.
   */
  async cachePredictions(trigger: TriggerType): Promise<boolean> {
    const document = vscode.window.activeTextEditor?.document
    if (!document) return false
    const position = vscode.window.activeTextEditor?.selection.active
    if (!position) return false

    const completionList = await this.callPredictionsAPI(document, position, trigger)
    if (completionList.items.length === 0) return false

    this.predictionCache = completionList
    return true 
  }

  /** Call the predictions API for code completions. 
   * You need to be careful to not call this method unnecessarily, as API calls are rate-limited.
   * @param document the document the completion was invoked
   * @param position the position of the cursor
   */
  private async callPredictionsAPI(
    document: vscode.TextDocument,
    position: vscode.Position,
    trigger: TriggerType,
  ): Promise<vscode.CompletionList> {
    
    // Wait for 200ms to simulate a slow API call
    await new Promise(resolve => setTimeout(resolve, 200))

    responseflakiness = !responseflakiness
    console.log(trigger, 'call to completions API', responseflakiness? 'stable' : 'flaky')

    let predictions: Array<string> = (responseflakiness) ? ['pred_new', 'pred_new_2', 'pred_old'] : []
    let verifyToken: string = (responseflakiness) ? 'verifyToken' : ''
    let survey: boolean = (responseflakiness) ? true : false

    predictions = predictions.filter((prediction: string) => prediction !== "");

    const completionItems :vscode.CompletionItem[] = predictions.map((prediction: string) => {
      return this.createCompletionItem(prediction, position, document, verifyToken)
    })

    if (predictions.length === 0) return this.predictionCache
    this.predictionCache = new vscode.CompletionList(completionItems, false)

    return this.predictionCache
  }

  private createCompletionItem(
    prediction: string, position: vscode.Position, document: vscode.TextDocument, 
    verifyToken: string
  ): vscode.CompletionItem
  {
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
      arguments: [prediction, position, document, verifyToken, this.uuid, () => {clearTimeout(this.idleTimer)}]
    };
    return item;
  }
}

/**
   * Calls verification API after a 30s timeout with the completion and the ground truth.
   * TODO: this implementation is incorrect. (also the lack of documentation does not help at all for tracking lines)
   * MVE: call completion on line 3, then delete line 3. The resulting `lineNumber` is 1 somehow. 
   * @param prediction prediction for which this callback is created
   * @param position position of the completion
   * @param document the prediction is in 
   * @param verifyToken query UUID 
   * @param uuid user UUID
   * @returns 
   */
function verifyInsertion(
  prediction: string, 
  position: vscode.Position, 
  document: vscode.TextDocument,
  verifyToken: string,
  uuid: string, 
  callback: () => void,
) {
  console.log('accepted completion: ', prediction, ' at position: ', position)
  // We clear the idle Timeout as accepting a completion counts as an interaction. 
  // But, we probably don't want to generate new completions instantly. 
  callback() 

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

  return setTimeout(async () => {
    listener.dispose();

    // given that the document may have been modified and no longer contain lineNumber lines,
    // set lineText to undefined if lineNumber is out of bounds
    const groundTruth = lineNumber < document.lineCount ? 
      document.lineAt(lineNumber).text?.substring(characterOffset).trim() : null;
    
    console.log(uuid, 'sending ground-truth: ', groundTruth, 'at line', lineNumber, ' and characterOffset: ', characterOffset)
    const response = await fetch("https://code4me.me/api/v1/prediction/verify", {
      method: 'POST',
      body: JSON.stringify(
        {
          "verifyToken": verifyToken,
          "chosenPrediction": prediction,
          "groundTruth": groundTruth, 
        }
      ),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + uuid
      }
    });

    if (!response.ok) {
      console.error("Response status not OK! Status: ", response.status);
      return undefined;
    }
  }, GROUND_TRUTH_DELAY_MS);
}


function showMaxRequestWindow(displayedText: string) {
  if (!promptMaxRequestWindow) return;
  vscode.window.showInformationMessage(
    displayedText,
    INFORMATION_WINDOW_CLOSE,
    MAX_REQUEST_WINDOW_CLOSE_1_HOUR,
    INFORMATION_WINDOW_DONT_SHOW_AGAIN
  ).then(selection => {
    if (selection === MAX_REQUEST_WINDOW_CLOSE_1_HOUR) {
      promptMaxRequestWindow = false;
      setTimeout(() => {
        promptMaxRequestWindow = true;
      }, 3600 * 1000);
    }
    if (selection === INFORMATION_WINDOW_DONT_SHOW_AGAIN) {
      promptMaxRequestWindow = false;
    }
  });
}

function showErrorWindow(text: string) {
  vscode.window.showInformationMessage(text);
}

function getTriggerCharacter(document: vscode.TextDocument, position: vscode.Position, length: number) {
  const endPos = new vscode.Position(position.line, position.character);
  if (position.character - length < 0) return undefined;
  const startCharacterPos = new vscode.Position(position.line, position.character - length);
  const rangeCharacter = new vscode.Range(startCharacterPos, endPos);
  const character = document.getText(rangeCharacter);
  return character.trim();
}

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

/**
 * Splits the current document on the cursor position, with AVG_TOKEN_LENGTH_IN_CHARS characters left and right of the cursor.
 * @param document the current document.
 * @param position the cursor position.
 * @returns an array with index 0 the left text and index 1 the right text. Empty strings if text editor cannot be found.
 */
function splitTextAtCursor(
  document: vscode.TextDocument, 
  position: vscode.Position
): string[] 
{
  // should not happen now that we directly pass document instead of relying on global state
  // as a result, this function can only be called IFF there is a TextDocument
  if (!document) return ['', ''] 

  const documentLineCount = document.lineCount - 1
  const lastLine = document.lineAt(documentLineCount)
  const beginDocumentPosition = new vscode.Position(0, 0)
  const leftRange = new vscode.Range(beginDocumentPosition, position)

  const lastLineCharacterOffset = lastLine.range.end.character
  const lastLineLineOffset = lastLine.lineNumber
  const endDocumentPosition = new vscode.Position(lastLineLineOffset, lastLineCharacterOffset)
  const rightRange = new vscode.Range(position, endDocumentPosition)

  const leftText = document.getText(leftRange)
  const rightText = document.getText(rightRange)

  return [
    leftText.substring(-AVG_TOKEN_LENGTH_IN_CHARS), 
    rightText.substring(0, AVG_TOKEN_LENGTH_IN_CHARS)
  ]
}

// async function callToAPIAndRetrieve(document: vscode.TextDocument, position: vscode.Position, code4MeUuid: string, triggerKind: vscode.CompletionTriggerKind): Promise<any | undefined> {
//   const textArray = splitTextAtCursor(document, position);
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