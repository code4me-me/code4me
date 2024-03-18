import * as vscode from 'vscode';
import rand from 'csprng';
import fetch, { Response } from 'node-fetch';
import * as path from 'path';
import { clear } from 'console';

// After how many ms the completion is manually triggered if the user is idle. 
const IDLE_TRIGGER_DELAY_MS = 3000; 
// After how many ms the automatic completion is sent to the server.
// I know this is suboptimal, but otherwise it's literally on almost every keystroke. 
// For reference, Copilot (2022 version) uses 75ms 
// 250 is quite a lot but it seems to be an upper bound almost. can always lower it later
const AUTO_DEBOUNCE_DELAY_MS = 300;
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

const AUTOCOMPLETE_URL = 'https://code4me.me/api/v2/prediction/autocomplete'
const VERIFY_URL       = 'https://code4me.me/api/v2/prediction/verify'

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
      if (event.contentChanges.length > 0) completionItemProvider.setIdleTrigger()
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

  /** Interface method for providing a (optionally preliminary) set of completions 
   * VSC Calls this somewhat arbitrarily whenever the user is typing (but not in comments/markdown cells). 
   * We want to provide completions, even in comments and markdown cells. 
   * Furthermore, if the promise this method returns is not resolved, VSC abstains from calling it again. 
   * 
   * So, to provide completion items analogously to an inline ghost-text display; We need to:
   * 1. Make sure promises are resolved ASAP. 
   * 2. Provide context-relevant completions (luckily document.getText() is a live method).
   * 3. Only call the completion API after debouncing to avoid unnecessary invocation and delay. 
   * I detail this further in the 'default' section, which concerns this type of invocation (the majority)
   */
  async provideCompletionItems(
    document: vscode.TextDocument, 
    position: vscode.Position, 
    token: vscode.CancellationToken, 
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionList | undefined> 
  {
    // console.log(`${this.trigger} called provideCompletionItems with ${context.triggerCharacter}`)
    clearTimeout(this.idleTimer)

    switch (this.trigger) {

      case 'idle': // Idle invocation means the API call just got cached 
        this.trigger = 'auto'
        // const shownTime = new Date().toISOString()
        // this.predictionCache.items.forEach(item => {item.shownTimes.push(shownTime)})
        return Promise.resolve(this.predictionCache)
      
      case 'manual':  // Manual invocations always call the API. 
        // No need to debounce these thanks to the IntelliSense UI (user cannot spam)
        this.trigger = 'auto'
        return this.getPredictions(document, position, 'manual', context.triggerCharacter)

      // Automatic invocations should have a trailing debounce (let me explain why this took 3 days)
      default:
        return await this.getPredictions(document, position, 'auto', context.triggerCharacter)

        /** We return a promise and we don't want it to take too long for it is resolved. 
         *  Particularly, we know we can resolve a promise the second the user types another character. 
         *  This is suboptimal (we lose a character of potential IntelliSense filtering strength)

         *  Optionally, we can also resolve these within a certain time; but for this to be reliable the
         *  timeout will be much too long and risk losing more keystrokes. 

         *  So, what can we do? We need a way to immediately (or ASAP) resolve promises, without
         *  knowing whether the user will type another character. The only option I see is time-based,
         *  but then this is practically the same as the idle timer 

         *  Okay, update: this is not at all the same as just using the idle timer (just tried it out)
         *  What happens is that even though we re-invoke triggerSuggest, the completion menu won't be updated
         *  If only we could actually control when provideCompletionItems is called... 
         *  or provide a mutable list of completions which I presume happens in the inline (ghost-text) version. 

         *  So, the next best thing is to:
         *  Set a callback on automatic invocation to resolve when EITHER 
         *  1. The user types another character (which we track with setIdleTrigger)
         *     Return predictionCache, as we want the user to be done typing before generating preds. 
         *  2. A set amount of time has passed (ideally <100ms the human reaction time)
         *     Call API, as we ASSUME the user is done typing.  

         *  Case 2 really warrants an entire study of its own; I am surprised about the lack 
         *  of information (and API support) out there on HCI regarding debounce timers, 
         *  even though they should be prominent on every web-based application. 

         *  Anyway, the above would make sense in most programming languages but this is JS. 
         *  As a result, our caching callback from (1) will only be called at the next event loop, 
         *  and the promise is only resolved at the end. This blocks provideCompletionItems from 
         *  being invoked for an entire loop, and prevents completions after the first one. 
         *  The system gets out of sync and all completions are blocked after the first. 

         *  So now we need to keep track of fucking event loops and lose another character on 
         *  some invocations. So, that's why we have a counter that keeps track, and 
         *  we check if the counter exceeds by more than 2 in which case we can be certain the 
         *  user continued typing. */ 


        //  this.debounce() // In theory we don't need to call this anymore as this method blocks

        // return new Promise((resolve, reject) => {
        //   const timer = setTimeout(() => {
        //     resolve(this.getPredictions(document, position, 'auto'))
        //     // this.trigger = 'idle'
        //     // vscode.commands.executeCommand('editor.action.triggerSuggest')
        //   }, AUTO_DEBOUNCE_DELAY_MS)
        //   this.cancelAuto = () => {
        //     resolve(this.predictionCache)
        //     clearTimeout(timer)
        //     this.cancelAuto = () => {} 
        //   }
        //   this.autoCount = 0
        // })

        // Alternatively, what if we replace the cache with a Promise? 
        // Intuitively, it seems like a bad idea to have a (essentially) mutable cache; 
        // because we need to ensure resolving in multiple methods (less coherent code)
        // But, maybe this is why we keep shooting ourselves in the foot with gridlocks 
        // Let's break it down case-by-case: 
        // 1. Manual does not warrant caching so no problem. It just updates the cache. 
        // 2. Idle invocations only cache completions AFTER they are received. Thus the cache 
        //    is just a place to store values temporarily. 
        // 3. Automatic Invocations either update completions or return existing ones (if it's a clear bad time)
        //    Yeah I leave this for someone else to figure out

        // Okay let's be utilistic here. 
        // We can also track changes using the 
    }
  }


  /** Interface method for updating completion items with additional information  */
  resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
    throw new Error('Method not implemented.');
  }
  
  /** Automatically invoke triggerSuggest if user is idle for `IDLE_TRIGGER_DELAY_MS` */
  async setIdleTrigger() {

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

    const document = vscode.window.activeTextEditor?.document
    if (!document) return false
    const position = vscode.window.activeTextEditor?.selection.active
    if (!position) return false

    const completionList = await this.getPredictions(document, position, trigger, undefined)
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
    triggerCharacter: string | undefined, 
  ): Promise<vscode.CompletionList<CustomCompletionItem>> {
    
    const response = await this.callCompletionsAPI(document, position, trigger)
    if (!response) return this.predictionCache 

    // response.predictions is Record<string, string>. Filter out empty predictions (second element in tuple)
    const predictions = Object.entries(response.predictions).filter(([_, value]) => value !== '')
    if (Object.values(predictions).length === 0) return new vscode.CompletionList([], false)

    const verifyToken = response.verifyToken
    const survey = response.survey
    const completionItems = predictions.map(prediction => {
      return this.createCompletionItem(prediction, document, position, triggerCharacter, verifyToken)
    })

    if (survey && this.config.get('promptSurvey')) {
      doPromptSurvey(this.uuid, this.config)
    }

    return new vscode.CompletionList(completionItems, true)
  }

  private createCompletionItem(
    prediction: [string, string], 
    document: vscode.TextDocument, 
    position: vscode.Position, 
    triggerCharacter: string | undefined, 
    verifyToken: string
  ): CustomCompletionItem
  {
    const [model, completion] = prediction
    const endPos = getCompletionSuffixPos(document, position, completion)
    const [prefix, startPos] = getCompletionPrefixAndPos(document, position, completion, triggerCharacter)

    const item = new vscode.CompletionItem(
      prefix + completion, 
      vscode.CompletionItemKind.EnumMember // I chose this as it is a relatively distinct icon 
    ) as CustomCompletionItem

    item.range = new vscode.Range(startPos, endPos) 
    // item.insertText = completion  // No longer necessary as 'detail' now contains the logo
    item.filterText = prefix + completion  // The culprit of why suggestions were ranked at the bottom
    // TODO: I'm not actually sure that the `sortText` below does anything. 
    item.sortText = (model === 'InCoder') ? '0' : (model === 'UniXCoder') ? '1' : '2'
    item.detail = '\u276E\uff0f\u276f' // Added the Logo here instead 
    item.documentation = 'Completion from ' + model

    item.command = {
      command: 'verifyInsertion',
      title: 'Verify Insertion',
      arguments: [prediction, position, document, verifyToken, this.uuid, item.shownTimes, () => {this.setIdleTrigger()}]
    };
    item.shownTimes = [new Date().toISOString()];

    // This is useful if you want to see what's exactly going on with the range and prefix modifications
    // I use • to denote the cursor position
    // console.log(`  ${prefix}•${prediction[1].slice(0, 10)} ${prediction[0]} \t -> ${prefix+completion} for ${document.getText(item.range)}`)
    return item;
  }

  private async callCompletionsAPI(
    document: vscode.TextDocument,
    position: vscode.Position,
    trigger: TriggerType
  ): Promise<CompletionResponse | undefined>
  {
    const [prefix, suffix] = splitTextAtCursor(document, position)
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

    // DEBUG
    const lastPrefixLine = prefix.split('\n').pop()
    const firstSuffixLine = suffix.split('\n').shift()
    const triggerString = `${trigger} call to completions API \t\`${lastPrefixLine?.slice(-10)}•${firstSuffixLine?.slice(0, 10)}\``
    console.log(triggerString)

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


/** Assuming that the IDE-inserted-scoping-characters `()` and `{}` by nature must always 
 * appear at the very start of the suffix when the user is typing normally (not infilling), 
 * we just need to iteratively check a larger range starting from suffix[0] to suffix[0:i], 
 * and see if it matches the generated completion.
 */
function getCompletionSuffixPos(
  document: vscode.TextDocument,
  position: vscode.Position, 
  completion: string, 
): vscode.Position {

  const curLine : vscode.TextLine = document.lineAt(position)
  let endPos: number = position.character

  // If the the line at which the completion is inserted has a substring after the cursor that matches 
  // part of the completion, we want to delete it to avoid replicating it (often happens with open/close chars)
  for (endPos; endPos <= curLine.range.end.character; endPos++) {
    const suffix : string = curLine.text.slice(position.character, endPos)
    if (!completion.includes(suffix)) {
      endPos -- 
      break 
    }
  }
  return new vscode.Position(position.line, endPos)
}

/** If the current position is attached to a word (i.e. prefix has no trailing space/context.triggerChar), 
 * then we want to prepend that last word to the insertText and filterText for it to show up in the menu,
 * and update the range. 
 * Additionally, we want to prepend a space if the previous word is a trigger word, like 'await' 
 */
function getCompletionPrefixAndPos(
  document: vscode.TextDocument,
  position: vscode.Position,
  completion: string,
  triggerCharacter: string | undefined, 
): [string, vscode.Position] {
  
  const wordRange = document.getWordRangeAtPosition(position)
  if (wordRange) {

    const lastPrefixWord = document.getText(wordRange)
    // it may be that lastWord ends with the same characters as the start of prediction[1]
    // in that case, we want to remove the overlapping letters of lastWord from prediction[1]
    // and then prepend lastWord to prediction[1]
    for (let i = 0; i < lastPrefixWord.length; i++) {
      if (completion.startsWith(lastPrefixWord.slice(i))) 
        return [lastPrefixWord.slice(0, i), position.translate(0, -i)]
    }

    // If the last word is a trigger word, we want to insert the completion with a space
    if (allowedTriggerWords.includes(lastPrefixWord)) 
      return [' ', position]

    // Alternatively, if the last word is simply the start of the completion, 
    // but they don't have any overlapping letters; we want to join them
    // for languages like fucking javascript to accept the completion
    if (!triggerCharacter) 
      return [lastPrefixWord, wordRange.start]
  }
  return ['', position]
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

  const leftText = document.getText(new vscode.Range(
    new vscode.Position(0, 0), position
  ))

  const lastLine = document.lineAt(document.lineCount - 1)
  const rightText = document.getText(new vscode.Range(
    position, new vscode.Position(lastLine.lineNumber, lastLine.range.end.character)
  ))

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
