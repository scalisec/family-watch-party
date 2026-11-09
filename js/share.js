// Saving a video to a chosen place on this computer, and sharing it.
import { h, toast } from './ui.js';

export async function saveBlobAs(blob, name) {
  if (window.showSaveFilePicker) {
    let handle;
    try {
      const ext = name.split('.').pop();
      handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Video', accept: { [blob.type || 'video/mp4']: [`.${ext}`] } }] });
    } catch (err) {
      if (err.name === 'AbortError') return false;
      throw err;
    }
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    toast(`Saved ${name}.`);
    return true;
  }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return true;
}

export async function shareBlob(blob, name, title) {
  const file = new File([blob], name, { type: blob.type || 'video/mp4' });
  if (!navigator.canShare || !navigator.canShare({ files: [file] })) {
    toast("This browser can't share video files. Use Save, then send it from your PC.", 6000);
    return false;
  }
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (err) {
    if (err.name !== 'AbortError') toast(`Couldn't share it: ${err.message}`, 6000);
    return false;
  }
}
