import * as vscode from 'vscode';
import rand from 'csprng';
import fetch, { Response } from 'node-fetch';
import * as path from 'path';
import { clear } from 'console';

// After how many ms the completion is manually triggered if the user is idle. 
const IDLE_TRIGGER_DELAY_MS = 2000; 
// After how many ms the automatic completion is sent to the server.
// I know this is suboptimal, but otherwise it's literally on almost every keystroke. 
// For reference, Copilot (2022 version) uses 75ms 
// 250 is quite a lot but it seems to be an upper bound almost. can always lower it later
const AUTO_DEBOUNCE_DELAY_MS = 700;
// After how many ms to return the ground truth 
const GROUND_TRUTH_DELAY_MS = 30000;

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
const SURVEY_WINDOW_SURVEY = "Survey"

const AVG_TOKEN_LENGTH_IN_CHARS = 7984;

const CODE4ME_EXTENSION_ID = 'Code4Me.code4me-plugin';
const CODE4ME_VERSION = vscode.extensions.getExtension(CODE4ME_EXTENSION_ID)?.packageJSON['version']

// // TODO: (revert) for testing purposes
// const AUTOCOMPLETE_URL = 'http://127.0.0.1:3000/api/v2/prediction/autocomplete'
// const VERIFY_URL = 'http://127.0.0.1:3000/api/v2/prediction/verify'

const AUTOCOMPLETE_URL = 'https://code4me.me/api/v2/prediction/autocomplete'
const VERIFY_URL = 'https://code4me.me/api/v2/prediction/autocomplete'

const allowedTriggerCharacters = [' ', '.', '+', '-', '*', '/', '%', '<', '>', '**', '<<', '>>', '&', '|', '^', '+=', '-=', '==', '!=', ';', ',', '[', '(', '{', '~', '=', '<=', '>='];
const allowedTriggerWords = ['await', 'assert', 'raise', 'del', 'lambda', 'yield', 'return', 'while', 'for', 'if', 'elif', 'else', 'global', 'in', 'and', 'not', 'or', 'is', 'with', 'except'];

// NOTE: extremely bad practice to put state at the top here, as 
// it is 1. not clear what it's for; 2. not disposed of properly when extension is deactivated
let promptMaxRequestWindow = true;

// Enum for triggers: manual, timeout, or automatic (default)
type TriggerType = 'manual' | 'idle' | 'auto' 

// Datatype for the response received from the API 
type CompletionResponse = {
  predictions: Record<string, string>,
  verifyToken: string, 
  survey: boolean
}

export function activate(context: vscode.ExtensionContext) {

  if (!context.globalState.get('code4me-uuid')) {
    context.globalState.update('code4me-uuid', rand(128, 16));
  }

  start(context).then(disposable => {
    context.subscriptions.push(disposable);
    console.log('Code4me Activated!')
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
    // TODO: Revert this after the user-study 
    // if (config.get('promptDataStorage')) { doPromptDataStorageMenu(config) }

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
  );

  return vscode.Disposable.from(...disposables)
}

async function createCompletionItemProvider(
  context: vscode.ExtensionContext, 
  config: vscode.WorkspaceConfiguration
): Promise<vscode.Disposable> {

  const disposables: vscode.Disposable[] = [] 

  // TODO: create an async function to retrieve language-specific settings, 
  const languageFilters = { pattern: '**' }
  const uuid : string = context.globalState.get('code4me-uuid')!;
  // console.log('uuid', uuid)
  const completionItemProvider = new CompletionItemProvider(uuid, config)

  disposables.push(
    // This is the only way I could figure out how to check for manual triggers. 
    // Override the keybind for vscode.actions.triggerSuggest (see package.json > keybinds)
    // As a result, vscode triggerSuggest is not called (still exists in the command palette)
    // Then, we can modify the completionItemProvider.manual property to true, and call triggerSuggest.
    vscode.commands.registerCommand('code4me.action.triggerSuggest', () => {
      completionItemProvider.trigger = 'manual'; 
      vscode.commands.executeCommand('editor.action.triggerSuggest')
    }),
    // Timeout trigger
    vscode.workspace.onDidChangeTextDocument((event) => { 
      if (event.contentChanges[0].rangeLength > 0) completionItemProvider.setIdleTrigger() 
    }),
    // Actual completions provider (+ handles automatic triggers)
    vscode.languages.registerCompletionItemProvider(
      languageFilters, completionItemProvider, ...allowedTriggerCharacters
    ), 
    vscode.commands.registerCommand('verifyInsertion', verifyInsertion)
  )

  return { dispose: () => { disposables.forEach(d => d.dispose()) } }
}

// NOTE: Class used in user study to provide inline completion items.
// Honestly, I'm biased but would strongly consider using this instead 
// of the previous code, as I fixed a few serious bugs  

// However, I realise that some of the debounce and timer code may look messy. 
// Honestly, I don't know why half of it works, but it seems to do exactly what I expect
// when I test it. 

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
  predictionCache: vscode.CompletionList<CustomCompletionItem> = new vscode.CompletionList([], false)

  /** Interface method for providing a (optionally preliminary) set of completions */
  async provideCompletionItems(
    document: vscode.TextDocument, 
    position: vscode.Position, 
    token: vscode.CancellationToken, 
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionList>
  {
    console.log('called provideCompletionItems')
    clearTimeout(this.idleTimer)
    // And, behold, why switch statements are actually not that great 
    switch (this.trigger) {

      // Timeout invocations will already have called the completion API, so we return the cache
      case 'idle':
        this.trigger = 'auto'
        const shownTime = new Date().toISOString()
        this.predictionCache.items.forEach(item => {item.shownTimes.push(shownTime)})
        return this.predictionCache 

      // Manual invocations always call the API. 
      // No need to debounce these thanks to the IntelliSense UI (user cannot spam)
      case 'manual':  
        this.trigger = 'auto'
        this.predictionCache = await this.getPredictions(document, position, 'manual')
        return this.predictionCache

      // Automatic invocations have a trailing debounce 
      default:
        return this.debounce((bool: Boolean) => {
          // this.useCache()
          return bool 
            ? this.getPredictions(document, position, 'auto') 
            : this.predictionCache
        }, AUTO_DEBOUNCE_DELAY_MS)
    }
  }

  wait: number = 0

  async debounce(cb: Function, delay: number): Promise<vscode.CompletionList> {

    this.wait += 1
    const wait = this.wait

    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        if (wait === this.wait) {
          this.wait = 0 
          await cb(true)
          .then(async () => {
            this.trigger = 'idle'  
            await vscode.commands.executeCommand('editor.action.triggerSuggest')
          })
        } else {
          return cb(false)
        }
      }, delay)
    })
  }


  /** Interface method for updating completion items with additional information  */
  resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
    throw new Error('Method not implemented.');
  }
  
  /** Automatically invoke triggerSuggest if user is idle for `IDLE_TRIGGER_DELAY_MS` */
  async setIdleTrigger() {
    // console.log('called setIdle')
    clearTimeout(this.idleTimer)
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

    // console.log('called cachePredictions')
    const document = vscode.window.activeTextEditor?.document
    if (!document) return false
    const position = vscode.window.activeTextEditor?.selection.active
    if (!position) return false

    // clearTimeout(this.timer)
    const completionList = await this.getPredictions(document, position, trigger)
    if (completionList.items.length === 0) return false

    this.predictionCache = completionList
    return true 
  }

  /** Call the predictions API for code completions and store in cache.  
   * You need to be careful to not call this method unnecessarily, as API calls are rate-limited.
   * @param document the document the completion was invoked
   * @param position the position of the cursor
   */
  private async getPredictions(
    document: vscode.TextDocument,
    position: vscode.Position,
    trigger: TriggerType,
  ): Promise<vscode.CompletionList<CustomCompletionItem>> {
    
    const response = await this.callCompletionsAPI(document, position, trigger)
    if (!response) return this.predictionCache 

    // response.predictions is Record<string, string>. 
    // filter out empty predictions (second element in tuple)
    const predictions = Object.entries(response.predictions).filter(([_, value]) => value !== '')
    const verifyToken = response.verifyToken
    const survey = response.survey

    // console.log('received predictions:', predictions.length, 'items', Object.values(predictions))
    if (Object.values(predictions).length === 0) return new vscode.CompletionList([], false)
    
    const completionItems = predictions.map(prediction => {
      return this.createCompletionItem(prediction, document, position, verifyToken)
    })

    if (survey && this.config.get('promptSurvey')) {
      doPromptSurvey(this.uuid, this.config)
    }

    this.predictionCache = new vscode.CompletionList(completionItems, false)

    if (trigger !== 'idle') { // We handle the 'idle' case in `provideCompletionItems`, closer to when they are displayed
      const shownTime = new Date().toISOString()
      this.predictionCache.items.forEach(item => {
        item.shownTimes.push(shownTime)
      })
    }

    // console.log('cached predictions:', this.predictionCache.items.length, 'items')
    return this.predictionCache
  }

  private createCompletionItem(
    prediction: [string, string], 
    document: vscode.TextDocument, 
    position: vscode.Position, 
    verifyToken: string
  ): CustomCompletionItem
  {
    // // If the current position is attached to a word (i.e. prefix has no trailing space), 
    // // then we want to prepend that last word to the insertText and filterText. 
    // // Otherwise, it doesn't show up in intellisense 
    // Something along the lines of the following; but consider using `document.getWordRangeAtPosition`
    // const prefix = document.getText(new vscode.Range(position.with(undefined, 0), position))
    // if (prefix.charAt(prefix.length - 1) !== ' ') {
    //   const lastWord = prefix.split(' ').pop()
    //   prediction[1] = lastWord + prediction[1]
    // }
    const wordRange = document.getWordRangeAtPosition(position)
    if (wordRange) {
      const lastWord = document.getText(wordRange)
      // prediction[1] = lastWord + prediction[1]
      // it may be that lastWord ends with the same characters as the start of prediction[1]
      // in that case, we want to remove the overlapping letters of lastWord from prediction[1]
      // and then prepend lastWord to prediction[1]
      for (let i = 0; i < lastWord.length; i++) {
        if (prediction[1].startsWith(lastWord.slice(i))) {
          prediction[1] = lastWord.slice(0, i) + prediction[1]
          break
        }
      }

      // if the last word is a trigger word, we want to insert the completion with a space
      if (allowedTriggerWords.includes(lastWord)) {
        prediction[1] = ' ' + prediction[1]
      }

    }

    const [model, completion] = prediction
    const item = new vscode.CompletionItem(
      completion, 
      vscode.CompletionItemKind.EnumMember // I chose this because it's less common than 'Property' 
    ) as CustomCompletionItem

    item.insertText = completion  // No longer necessary as 'detail' now contains the logo
    item.filterText = completion  // The culprit of why suggestions were ranked at the bottom
    // item.sortText = '0' // Force sort at the top always (when compared with other identical prefixes)
    // Sort model === incoder 0, model === unixcoder 1, model === chatgpt 2, based on Models above 
    item.sortText = (model === 'InCoder') ? '0' : (model === 'UniXCoder') ? '1' : '2'
    item.detail = '\u276E\uff0f\u276f' // Logo 
  
    item.documentation = 'Completion from ' + model

    try {
      const positionFromCompletionToEndOfLine = new vscode.Position(position.line, document.lineAt(position.line).range.end.character);
      const positionPlusOne = new vscode.Position(position.line, position.character + 1);
      const charactersAfterCursor = document.getText(new vscode.Range(position, positionFromCompletionToEndOfLine));
      const characterAfterCursor = charactersAfterCursor.charAt(0);

      const lastTwoCharacterOfPrediction = completion.slice(-2);
      const lastCharacterOfPrediction = completion.slice(-1);

      if (lastTwoCharacterOfPrediction === '):' || lastTwoCharacterOfPrediction === ');' || lastTwoCharacterOfPrediction === '),') {
        item.range = new vscode.Range(position, positionFromCompletionToEndOfLine);
      } else if (characterAfterCursor === lastCharacterOfPrediction) {
        item.range = new vscode.Range(position, positionPlusOne);
      }
    } catch (e) {
      // this can happen when the line position is no longer valid in the document, 
      // e.g. if the user deletes some lines 
    }
      item.shownTimes = [];

    // console.log('called createCompletionItem')
    item.command = {
      command: 'verifyInsertion',
      title: 'Verify Insertion',
      arguments: [prediction, position, document, verifyToken, this.uuid, item.shownTimes, () => {clearTimeout(this.idleTimer)}]
    };
    return item;
  }

  private async callCompletionsAPI(
    document: vscode.TextDocument,
    position: vscode.Position,
    trigger: TriggerType
  ): Promise<CompletionResponse | undefined>
  {
    const liveDocument :vscode.TextDocument = vscode.window.activeTextEditor?.document || document 
    const livePosition :vscode.Position = vscode.window.activeTextEditor?.selection.active || position

    const [prefix, suffix] = splitTextAtCursor(liveDocument, livePosition)
    const storeContext = this.config.get('storeContext')
    const languageId = document.languageId

    const body = {
      'prefix': prefix,
      'suffix': suffix,
      'trigger': trigger,
      'language': languageId, 
      'ide': 'vsc',
      'version': CODE4ME_VERSION,
      'store': storeContext,
    }

    console.log(trigger, 'call to completions API')
    const clearIdleTimer = () => { clearTimeout(this.idleTimer) }
    clearIdleTimer() // welcome to JS where callbacks are executed after promises but before the next event loop

    try {
      const response = await fetch(AUTOCOMPLETE_URL, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json', 
          'Authorization': 'Bearer ' + this.uuid
        }
      });

      if (response.status === 429) {
        showMaxRequestWindow('You have exceeded the limit of 4000 suggestions per hour.')
      }

      const data = await response.json();
      clearTimeout(this.idleTimer)

      // Create a CompletionResponse object from data, throw error if not possible 
      return (!data.predictions) ? 
        undefined : data as CompletionResponse
    }
    catch (e) {
      console.error("Unexpected error: ", e);
      showErrorWindow("Unexpected error: " + e);
      return undefined;
    }
  }
}

/** Extend the completionItem class with shownTimes field so TS doesn't throw a tantrum */
class CustomCompletionItem extends vscode.CompletionItem {
  shownTimes: string[] = []
}

/**
   * Calls verification API after a 30s timeout with the completion and the ground truth.
   * TODO: this implementation is incorrect. (also the lack of documentation does not help at all for tracking lines)
   * MVE: call completion on line 3, then delete line 3. The resulting `lineNumber` is 1 somehow. 
   * @param completion prediction for which this callback is created
   * @param position position of the completion
   * @param document the prediction is in 
   * @param verifyToken query UUID 
   * @param uuid user UUID
   * @returns 
   */
function verifyInsertion(
  prediction: [string, string], 
  position: vscode.Position, 
  document: vscode.TextDocument,
  verifyToken: string,
  uuid: string,
  shownTimes: string[], 
  timeout_callback: () => void,
) {
  // We clear the idle Timeout as accepting a completion counts as an interaction. 
  // But, we probably don't want to generate new completions instantly. 
  timeout_callback() 
  const acceptTime = new Date().toISOString()

  const [model, completion] = prediction
  // console.log('accepted completion:', completion, 'by model', model, 'at position:', position)
  console.log(`accepted ${model}'s completion at (${position.line}, ${position.character}): ${completion}`)

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
    
    console.log(`sending ground-truth: ${groundTruth} at (${lineNumber}, ${characterOffset})`)

    const body = {
      'verifyToken': verifyToken,
      'chosen_model': model, 
      'ground_truth': groundTruth,
      'shown_times': shownTimes,
      'accept_time': acceptTime,
    }

    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body: JSON.stringify(body),
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
