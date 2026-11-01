/** Downloads a version's manifest as SDRF (validated by apps/compute); throws with the API's message on failure. */
export async function downloadVersionSdrf(versionId: string): Promise<void> {
  const res = await fetch(`/api/v1/versions/${versionId}/sdrf`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ message: `HTTP ${res.status}` }))) as { message: string };
    throw new Error(body.message);
  }
  const name =
    /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'manifest.sdrf.tsv';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
