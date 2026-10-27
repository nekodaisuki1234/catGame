# day. デザイン候補

公開URL: https://nekodaisuki1234.github.io/catGame/attendance-demo/designs/

社員は架空の田中花子1人。2026年10月27日の固定サンプルと前日1日分だけを使います。勤務前・勤務中・退勤後の表示を、全候補で同じ内容に切り替えられます。各ページの「画面だけ見る」で比較用メニューを隠し、実際の画面に近い状態でも見られます。

- A. Paper: 余白のある手帳（a-paper.html）
- B. Studio: 文字が主役のエディトリアル（b-studio.html）
- C. Soft: やわらかな北欧調（c-soft.html）
- D. Grid: 白とコバルトのグリッド（d-grid.html）
- E. Night: 円と半円のナイトポスター（e-night.html）

既存のattendance-demoのコードや保存データには触れません。サンプル編集は専用のsessionStorageキー day-design-studies-v1 に保存し、比較ページ内だけで引き継ぎます。実際の現在時刻・社員・勤務実績ではありません。

候補は共通の studies.css / studies.js を使用。Nightの幾何学アートは同梱の night-art.svg です。色だけでなく、時計と日付の構図、書体、角丸、区切り、余白を切り替えています。外部フォント・画像・ライブラリは不要です。

実際のJavaScriptを軽量DOM上で実行し、5案の共通データ、状態切り替え、手入力、休憩プリセット、取消、別案への引き継ぎ、サンプル保存の分離を確認しました。ブラウザ・実機での目視確認は未実施です。
