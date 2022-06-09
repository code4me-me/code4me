import * as vscode from 'vscode';
import { ExtensionContext } from 'vscode';
import rand from 'csprng';
import fetch from 'node-fetch';

const averageTokenLengthInCharacters = 3992;
let promptSurvey = true;
let promptMaxRequestWindow = true;

export function activate(extensionContext: ExtensionContext) {
  if (!extensionContext.globalState.get('code4me-uuid')) {
    extensionContext.globalState.update('code4me-uuid', rand(128, 16));
  }

  const code4MeUuid: string = extensionContext.globalState.get('code4me-uuid')!;

  extensionContext.subscriptions.push(vscode.commands.registerCommand('verifyInsertion', verifyInsertion));

  extensionContext.subscriptions.push(vscode.languages.registerCompletionItemProvider('python', {
    async provideCompletionItems(document, position, token, context) {
      const jsonResponse = await callToAPIAndRetrieve(document, position, code4MeUuid);
      if (!jsonResponse) return undefined;

      const listPredictionItems = jsonResponse.predictions;
      if (listPredictionItems.length == 0) return undefined;
      const completionToken = jsonResponse.verifyToken;

      if (jsonResponse.survey && promptSurvey) doPromptSurvey();

      const timer = verifyInsertion(position, null, completionToken, code4MeUuid, null);
      return listPredictionItems.map((prediction: string) => {
        const completionItem = new vscode.CompletionItem('\u276E\uff0f\u276f: ' + prediction);
        completionItem.sortText = '0.0000';
        if (prediction == "") return undefined;
        completionItem.insertText = prediction;
        completionItem.command = {
          command: 'verifyInsertion',
          title: 'Verify Insertion',
          arguments: [position, prediction, completionToken, code4MeUuid, timer]
        };
        return completionItem;
      });
    }
  }, ' ', '.', '+', '-', '*', '/', '%', '*', '<', '>', '&', '|', '^', '=', '!', ';', ',', '[', '(', '{', '~'));
}

function doPromptSurvey() {
  vscode.window.showInformationMessage('Do you mind filling in a quick survey about Code4Me?', ...["Survey", "Later", "Don't ask again"]).then(selection => {
    if (selection === "Survey") {
      vscode.commands.executeCommand('vscode.open', vscode.Uri.parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
    }
    if (selection === "Don't ask again") {
      promptSurvey = false;
    }
  });
}

function showMaxRequestWindow(text: string) {
  if (!promptMaxRequestWindow) return;
  vscode.window.showInformationMessage(text, ...["Close", "Close for 1 hour", "Don't show again"]).then(selection => {
    if (selection === "Close for 1 hour") {
      promptMaxRequestWindow = false;
      setTimeout(() => {
        promptMaxRequestWindow = true;
      }, 3600 * 1000);
    }
    if (selection === "Don't show again") {
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
  const character = document.getText(rangeCharacter).trim();
  return character;
}

/**
 * Returns the trigger character used for the completion.
 * @param document the document the completion was triggered.
 * @param position the current position of the cursor.
 * @returns triggerCharacter string or null (manual trigger suggest) or undefined if no trigger character was found.
 */
function determineTriggerCharacter(document: vscode.TextDocument, position: vscode.Position) {
  const singleTriggerCharacter = getTriggerCharacter(document, position, 1);
  const doubleTriggerCharacter = getTriggerCharacter(document, position, 2);
  const tripleTriggerCharacter = getTriggerCharacter(document, position, 3);
  const line = document.lineAt(position.line).text;

  if (position.character !== line.length) return undefined;

  const startPosLine = new vscode.Position(position.line, 0);
  const endPosLine = new vscode.Position(position.line, position.character);
  const rangeLine = new vscode.Range(startPosLine, endPosLine);

  const lineSplit = document.getText(rangeLine).match(/[\w]+/g);

  if (lineSplit == null) return null;
  const lastWord = lineSplit!.pop()!;

  const allowedTriggerCharacters = ['.', '+', '-', '*', '/', '%', '**', '<<', '>>', '&', '|', '^', '+=', '-=', '==', '!=', ';', ',', '[', '(', '{', '~', '=', '<=', '>='];
  const allowedTriggerWords = ['await', 'assert', 'raise', 'del', 'lambda', 'yield', 'return', 'while', 'for', 'if', 'elif', 'else', 'global', 'in', 'and', 'not', 'or', 'is'];

  if (allowedTriggerWords.includes(lastWord)) return lastWord;
  if (tripleTriggerCharacter && allowedTriggerCharacters.includes(tripleTriggerCharacter)) return tripleTriggerCharacter;
  if (doubleTriggerCharacter && allowedTriggerCharacters.includes(doubleTriggerCharacter)) return doubleTriggerCharacter;
  if (singleTriggerCharacter && allowedTriggerCharacters.includes(singleTriggerCharacter)) return singleTriggerCharacter;
  return undefined;
}

/**
 * 
 * @param nCharacters the amount of characters taken left and right of the cursor.
 * @param position the cursor position.
 * @returns an array with index 0 the left text and index 1 the right text. Empty strings if text editor cannot be found.
 */
function splitTextAtCursor(nCharacters: number, position: vscode.Position): string[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return ['', ''];
  const document = editor.document;
  const documentLineCount = document.lineCount - 1;
  const lastLine = document.lineAt(documentLineCount);
  const beginDocumentPosition = new vscode.Position(0, 0);
  const leftRange = new vscode.Range(beginDocumentPosition, position);

  const lastLineCharacterOffset = lastLine.range.end.character;
  const lastLineLineOffset = lastLine.lineNumber;
  const endDocumentPosition = new vscode.Position(lastLineLineOffset, lastLineCharacterOffset);
  const rightRange = new vscode.Range(position, endDocumentPosition);

  const leftText = editor.document.getText(leftRange);
  const rightText = editor.document.getText(rightRange);

  return [leftText.substring(-nCharacters), rightText.substring(0, nCharacters)];
}

async function callToAPIAndRetrieve(document: vscode.TextDocument, position: vscode.Position, code4MeUuid: string): Promise<any | undefined> {
  const textArray = splitTextAtCursor(averageTokenLengthInCharacters, position);
  const triggerPoint = determineTriggerCharacter(document, position);
  if (triggerPoint === undefined) return undefined;
  const textLeft = textArray[0];
  const textRight = textArray[1];
  try {
    const url = "https://code4me.me/api/v1/prediction/autocomplete";
    const response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(
        {
          "leftContext": textLeft,
          "rightContext": textRight,
          "triggerPoint": triggerPoint,
          "language": "python",
          "ide": "vsc"
        }
      ),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + code4MeUuid
      }
    });

    if (!response.ok) {
      console.error("Response status not OK! Status: ", response.status);
      return undefined;
    }

    if (response.ok) {
    // if (response.status == 429) {
      showMaxRequestWindow("You have exceeded the limit of 1000 suggestions per hour.");
      return undefined;
    }

    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error("Wrong content type!");
      return undefined;
    }

    const json = await response.json();

    if (!Object.prototype.hasOwnProperty.call(json, 'predictions')) {
      console.error("Predictions field not found in response!");
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(json, 'verifyToken')) {
      console.error("VerifyToken field not found in response!");
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(json, 'survey')) {
      console.error("Survey field not found in response!");
      return undefined;
    }
    return json;
  } catch (e) {
    console.error("Unexpected error: ", e);
    showErrorWindow("Unexpected error: " + e);
    return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() { }

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
