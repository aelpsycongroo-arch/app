import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export const isNativeApp = () => Capacitor.isNativePlatform();

/**
 * Saves a text file for the user. In the browser this is a normal download;
 * in the Android app (where WebView downloads do nothing) the file is written
 * to the app cache and handed to the system share sheet (Drive, email, Files…).
 */
export async function saveTextFile(fileName: string, text: string, mimeType: string) {
  if (isNativeApp()) {
    const { uri } = await Filesystem.writeFile({ path: fileName, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: fileName, files: [uri] });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mimeType }));
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}
