# 制御盤ARシミュレーション(試作)

スマホのブラウザで、指定サイズの制御盤(箱)を現実の床に実寸で置き、写真・動画を撮るWebアプリ。
ビルド不要の静的ファイル(index.html / app.js / style.css)。three.js は CDN から読み込む。

## 方式
| 端末 | AR表示 | 撮影・保存 |
|---|---|---|
| iPhone (Chrome / Safari) | 入力サイズからUSDZを生成し AR Quick Look で表示(拡大縮小は禁止して実寸固定)。扉はプレビューで選んだ開閉状態で表示。USDZ は Service Worker(sw.js)経由で通常の URL として渡す | Quick Look のシャッター(タップ=写真、長押し=動画)→ カメラロール |
| Android (Chrome, ARCore対応機) | WebXR immersive-ar + hit-test。白い丸を長押しで配置、盤の足元の輪をなぞって回転、扉をタップで開閉 | カメラ映像を取り込み(camera-access)盤と合成(カメラ風UI、置くまで撮影不可)→ JPEG / MP4(非対応ならWebM)をダウンロード |

iOS はどのブラウザも WebKit で WebXR 非対応のため、iPhone は OS 標準の AR Quick Look を使う。iOS 版 Chrome は blob: URL の USDZ を Quick Look で開けないことがあるため、Service Worker で配る。

## 動かし方
WebXR もカメラも HTTPS が必須。静的ホスティング(GitHub Pages 等)に置いてスマホで開く。
PCでの確認は `python3 -m http.server` で画面とプレビューのみ可(ARボタンは無効表示)。

## 未確認事項
- 実機での動作は未確認。特に iOS 版 Chrome で Quick Look が開くかは要確認。
- Android でカメラ映像の上下が逆になる場合は URL に `?flip=1` を付ける。
- camera-access 非対応の Android では撮影ボタンを無効化し、端末のスクリーンショット/画面録画を案内する。
- Android の保存先は「ダウンロード」フォルダ(Googleフォトでは端末内フォルダとして表示)。

## 盤モデル
筐体(背板・側板・天板・底板)+取付板+扉。幅 900mm 超は両開き。扉はプレビューの「扉を開く」ボタンか扉のタップで開閉する。
