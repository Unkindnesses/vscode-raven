import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const RAVEN_NODE_VERSION = 'v25.2.1';

export async function ensureWindowsNodeBinary(context: vscode.ExtensionContext): Promise<string> {
	const arch = getWindowsNodeArch();
	if (!arch) throw new Error(`Unsupported Windows architecture "${process.arch}".`);
	const versionDir = path.join(context.globalStorageUri.fsPath, 'node', `${RAVEN_NODE_VERSION}-${arch}`);
	console.log(versionDir)
	const nodePath = path.join(versionDir, 'node.exe');
	if (await fileExists(nodePath)) return nodePath;
	await vscode.workspace.fs.createDirectory(vscode.Uri.file(versionDir));
	const downloadUrl = `https://nodejs.org/dist/${RAVEN_NODE_VERSION}/win-${arch}/node.exe`;
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: 'Raven: Downloading Node.js runtime',
		cancellable: true
	}, async (progress, token) => {
		const tmpPath = `${nodePath}.download`;
		try {
			await downloadFile(downloadUrl, tmpPath, progress, token);
			await fs.promises.rename(tmpPath, nodePath);
		} finally {
			if (await fileExists(tmpPath)) await fs.promises.unlink(tmpPath);
		}
	});
	return nodePath;
}

function getWindowsNodeArch(): string | undefined {
	switch (process.arch) {
		case 'x64':
		case 'arm64':
			return process.arch;
		case 'ia32':
			return 'x86';
		default:
			return undefined;
	}
}

function fileExists(targetPath: string): Promise<boolean> {
	return fs.promises.access(targetPath, fs.constants.F_OK)
		.then(() => true)
		.catch(() => false);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadFile(
	url: string,
	destination: string,
	progress: vscode.Progress<{ message?: string; increment?: number }>,
	token: vscode.CancellationToken
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const seenCancel = { value: false };
		const startRequest = (currentUrl: string) => {
			const request = https.get(currentUrl, response => {
				if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
					const redirected = new URL(response.headers.location, currentUrl).toString();
					request.destroy();
					startRequest(redirected);
					return;
				}
				if (response.statusCode !== 200) {
					reject(new Error(`Download failed with status ${response.statusCode}`));
					response.resume();
					return;
				}
				const totalBytes = Number(response.headers['content-length'] ?? 0);
				let receivedBytes = 0;
				const fileStream = fs.createWriteStream(destination);
				const cancel = () => {
					if (seenCancel.value) {
						return;
					}
					seenCancel.value = true;
					request.destroy();
					fileStream.destroy();
					reject(new vscode.CancellationError());
				};
				token.onCancellationRequested(cancel);
				response.on('data', chunk => {
					receivedBytes += chunk.length;
					if (totalBytes > 0) {
						progress.report({
							message: `Downloading Node.js (${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)})`,
							increment: (chunk.length / totalBytes) * 100
						});
					} else {
						progress.report({
							message: `Downloading Node.js (${formatBytes(receivedBytes)})`
						});
					}
				});
				fileStream.on('finish', () => fileStream.close());
				fileStream.on('close', () => {
					progress.report({ message: 'Download complete' });
					resolve();
				});
				fileStream.on('error', reject);
				response.on('error', reject);
				response.pipe(fileStream);
			});
			request.on('error', reject);
			token.onCancellationRequested(() => request.destroy());
		};
		startRequest(url);
	});
}
