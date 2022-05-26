/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import * as vscode from 'vscode';
import { ExtensionContext } from 'vscode';
import rand from 'csprng';
import fetch from 'node-fetch';

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
			

			return listPredictionItems.map((prediction: string) => {
				const completionItem = new vscode.CompletionItem('\u276E\uff0f\u276f: ' + prediction);
				completionItem.sortText = '0.0000';
				completionItem.insertText = prediction;
				completionItem.command = {
					command: 'verifyInsertion',
					title: 'Verify Insertion',
					arguments: [position, prediction, completionToken, code4MeUuid]
				};
				return completionItem;
			});
		}
	}, ' ', '.', '+', '-', '*', '/', '%', '*', '<', '>', '&', '|', '^', '=', '!', ';', ',', '[', '(', '{', '~'));
}

/**
 * Returns the trigger character used for the completion.
 * @param document the document the completion was triggered.
 * @param position the current position of the cursor.
 * @returns triggerCharacter string or null (manual trigger suggest) or undefined if no trigger character was found.
 */
function getTriggerCharacter(document: vscode.TextDocument, position: vscode.Position) {
	const endPos = new vscode.Position(position.line, position.character);
	const startSingleCharacterPos = new vscode.Position(position.line, position.character - 1);
	const rangeSingleCharacter = new vscode.Range(startSingleCharacterPos, endPos);

	const startDoubleCharacterPos = new vscode.Position(position.line, position.character - 2);
	const rangeDoubleCharacter = new vscode.Range(startDoubleCharacterPos, endPos);

	const startTripleCharacterPos = new vscode.Position(position.line, position.character - 3);
	const rangeTripleCharacter = new vscode.Range(startTripleCharacterPos, endPos);

	const singleCharacter = document.getText(rangeSingleCharacter).trim();
	const doubleCharacter = document.getText(rangeDoubleCharacter).trim();
	const tripleCharacter = document.getText(rangeTripleCharacter).trim();

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

	let triggerCharacter = lastWord;
	if (!allowedTriggerWords.includes(triggerCharacter)) {
		triggerCharacter = tripleCharacter;
		if (!allowedTriggerCharacters.includes(triggerCharacter))
		triggerCharacter = doubleCharacter;
		if (!allowedTriggerCharacters.includes(triggerCharacter)) {
			triggerCharacter = singleCharacter;
			if (!allowedTriggerCharacters.includes(triggerCharacter)) return undefined;
		}
	}

	return triggerCharacter;
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
	const textArray = splitTextAtCursor(2048, position);
	const triggerPoint = getTriggerCharacter(document, position);
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
		return json;
	} catch (e) {
		console.error("Unexpected error: ", e);
		return undefined;
	}
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
export function deactivate() { }

/**
 * Tracks the inserted completion and sends the possibly changed completion after a timeout.
 * @param position cursor position.
 * @param completion the completion provided by the server.
 * @param completionToken the token of the completion provided by the server.
 * @param apiKey the identifier of the user.
 */
function verifyInsertion(position: vscode.Position, completion: string, completionToken: string, apiKey: string) {
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

	setTimeout(async () => {
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
	}, 5000);
}
