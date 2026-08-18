// デプロイ完了を待ってから、写真のある行を書き直して高さ60pxを適用する
const started = Date.now();
while (Date.now() - started < 480000) {
  await new Promise(r => setTimeout(r, 20000));
  if (Date.now() - started > 150000) break;
}
console.log('waited');
