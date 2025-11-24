import * as vscode from 'vscode';
import * as path from 'path';
import { ensureWindowsNodeBinary } from './nodeRuntime';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('raven-lang.installCLI', async () => {
		const scriptDir = path.join(context.extensionPath, 'script');
		const env = context.environmentVariableCollection;
		env.clear();
		env.description = 'Raven: add bundled CLI to PATH';
		try {
			const ravenNode = process.platform === 'win32'
				? await ensureWindowsNodeBinary(context)
				: process.execPath;
			env.prepend('PATH', `${scriptDir}${path.delimiter}`);
			env.replace('RAVEN_NODE', ravenNode);
			vscode.window.showInformationMessage('Raven command is ready in new terminals.');
		} catch (error) {
			env.clear();
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to set up the Raven command: ${message}`);
		}
	});
	context.subscriptions.push(disposable);
	disposable = vscode.commands.registerCommand('raven-lang.removeCLI', () => {
		const env = context.environmentVariableCollection;
		env.clear();
	});
	context.subscriptions.push(disposable);
}

export function deactivate() {}
