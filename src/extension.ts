import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('raven-lang.installCLI', () => {
		const scriptDir = path.join(context.extensionPath, 'script');
		const env = context.environmentVariableCollection;
		env.clear();
		env.description = 'Raven: add bundled CLI to PATH';
		env.prepend('PATH', `${scriptDir}${path.delimiter}`);
		env.replace('RAVEN_NODE', process.execPath);
	});
	context.subscriptions.push(disposable);
	disposable = vscode.commands.registerCommand('raven-lang.removeCLI', () => {
		const env = context.environmentVariableCollection;
		env.clear();
	});
	context.subscriptions.push(disposable);
}

export function deactivate() {}
