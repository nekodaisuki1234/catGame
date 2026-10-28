# 日別勤怠API・Excelテンプレート出力

A. Paper の日別記録と検証ルールを、AWSで動かすためのバックエンドです。同じリポジトリの `day-designs/paper-core.js` と `paper-holidays.js` を利用します。

このコードの追加だけではAWSリソースは作成されません。既存画面の保存先も引き続きブラウザのローカルストレージです。実際のAWS接続、Microsoft 365のログイン画面、既存データの移行はまだ行いません。

## モックを確認して確定した仕様

- 日別記録は出退勤、翌日退勤、休憩分数、勤務場所、作業内容、休暇区分、代休元日、P1〜P4・SETの工数です。第5の工数は **SET** です。
- 実働・欠勤時間・有給取得数は記録から計算します。工数のAPI値は時間単位で、分単位に換算できる値だけを許可します。休憩時間の初期値は60分です。
- 出退勤・休憩の変更では、手動で割り振ったP2〜SETを維持してP1を調整します。退勤前やマイナス実働の保存を許可します。
- 編集画面に相当する全項目更新では、退勤入力済みで実働が0以上なら工数合計の一致を求めます。マイナス実働の保存は許可し、確認済み出力を止めます。
- 平日の実働4時間以下は有休・半休の登録を求めます。午前・午後半休を登録済みなら、この短時間チェックを免除します。8時間に足りないこと自体は欠勤時間の警告・集計の対象で、追加の提出エラーにはしません。
- 作業実績がある日の空白だけの作業内容、工数不一致、未入力・退勤未入力、マイナス実働などは、確認済み出力時に日付付きで返します。画面から渡された「検証済み」のフラグは信用しません。
- 土日・公式祝日に出退勤を登録すると休日出勤として扱います。「休日出勤」を選ぶ専用の区分はありません。休日出勤には「4時間以下なら有休」のチェックを適用しません。
- 代休は、実働が正の過去の休日出勤1日と、代休1日を紐付けます。半日分割はしません。同じ元日の二重利用、利用中の元日削除や実働をなくす変更を拒否します。
- 祝日データは2026〜2027年です。会社独自の休日カレンダーは未対応です。未収録の平日を含む期間は、確認済み出力を止めます。

モックの既存Excel出力は新しいブックを作る方式です。このバックエンドは、承認された `.xlsx` テンプレートを読み、設定されたセルだけにデータを書きます。実際の会社テンプレートはリポジトリに含まれていません。

## API

各ルートは、Microsoft Entra IDがこのAPI用に発行したアクセストークンを必要とします。API Gatewayでissuer・audience・有効期限・委任scopeを検証し、Lambdaも検証済みclaimsのtenant、社員object ID、scopeを確認します。社員は `tid` と `oid` から決まり、リクエスト本文で別の社員を指定できません。IDトークンや、別API用のアクセストークンは利用しません。

| Method / path | 内容 |
| --- | --- |
| `GET /v1/days?start=YYYY-MM-DD&end=YYYY-MM-DD` | 最大366日の日別記録、設定、更新番号、期間内の集計・未入力日を取得 |
| `PUT /v1/days/{day}` | 日別記録を全項目更新。完成済み・非負実働の工数合計を検証 |
| `PATCH /v1/days/{day}/time` | 出退勤・翌日退勤・休憩のみ変更。P1を自動調整し、他PJ工数を保持 |
| `DELETE /v1/days/{day}` | 日別記録を未入力に戻す。利用中の代休元日は削除不可 |
| `PUT /v1/config` | 勤務表設定・初期値を更新。社員情報と利用開始日は変更不可 |
| `POST /v1/exports` | 指定期間のExcelと出力時点のスナップショットを保存 |
| `GET /v1/exports/{id}` | 自分の出力記録に対する期限付き取得URLを再発行 |

更新処理は、取得時の `revision` を `expectedRevision` として渡します。同じ社員の記録・設定が別の操作で更新されていれば409で拒否します。画面側は再取得し、未保存の入力と変更内容を確認してから再送してください。

全項目更新の例です。

```json
{
  "expectedRevision": 7,
  "record": {
    "start": "09:00",
    "end": "18:00",
    "overnight": false,
    "breakMinutes": 60,
    "locationId": "place1",
    "note": "テスト対応",
    "leave": "",
    "sourceDay": "",
    "allocation": { "P1": 6, "P2": 2, "P3": 0, "P4": 0, "SET": 0 }
  }
}
```

時刻だけの変更例です。警告はレスポンスの `warnings` に返し、保存結果と分けます。

```json
{
  "expectedRevision": 8,
  "changes": { "end": "17:00", "breakMinutes": 60 }
}
```

`PUT /v1/config` は `expectedRevision`、`settings`、`defaults` を受け取ります。取得した設定一式を編集して返し、`settings.employee` と `settings.attendanceStartDay` は取得値を維持します。社員プロフィールは管理者が事前登録します。未登録の社員に架空データを自動作成しません。

Excel出力の例です。

```json
{
  "expectedRevision": 9,
  "period": { "start": "2026-10-01", "end": "2026-10-31" },
  "purpose": "checked"
}
```

- `checked`（省略時）: 共通検証に合格した記録だけを出力します。問題があれば422と日別の理由を返します。
- `review`: 確認用に出力し、検証結果を一緒に返します。検証済み・提出済みには扱いません。

このAPIは **Excel出力** です。メール送信・上長承認・正式な提出状態の確定は行いません。出力には取得元revision、期間、目的、検証結果、テンプレート版を保存します。レンダリング中に記録が変わった場合は出力確定を拒否し、成功URLを返しません。DynamoDBの応答が不明な場合は、確定済みデータを誤って消さず、出力番号で状態を再確認できるようにします。

## DynamoDBの持ち方

テーブルは1つで、社員ごとのパーティション内に日別アイテムを作ります。

| PK | SK | 内容 |
| --- | --- | --- |
| `T#{tid}#E#{oid}` | `REVISION` | 社員全体の更新番号 |
| 同上 | `CONFIG` | 社員情報、記録開始日、勤務表設定、初期値 |
| 同上 | `DAY#2026-10-28` | その日の記録 |
| 同上 | `COMP#2026-10-24` | 休日出勤日と利用先の代休日の対応 |
| 同上 | `EXPORT#{出力ID}` | 出力時のrevision、検証結果、S3保存先など |

日付範囲のQueryと、代休の関連日に絞った追加取得を使います。全社員をScanしません。代休の一意な紐付けと元日の変更は、更新番号を含むDynamoDBトランザクションで確定します。読み取りの前後で更新番号を確認し、異なる時点の記録を組み合わせないようにします。

設定を打刻のたびに再保存しないため、`CONFIG` と `REVISION` は別アイテムです。社員番号は業務情報、Entraの`oid`はアクセス範囲を決めるIDとして分けます。

## Excelテンプレート

テンプレートをそのまま読み込んでコピーし、[セル対応表の例](examples/template-mapping.example.json)で指定されたセルに書き込みます。この例のセル位置は説明用です。実テンプレートに合うことを確認してから利用してください。

主な設定は、対象シート、氏名・期間などの固定セル、日別行の開始位置と収容日数、各項目の列、合計のセルです。最大行数を超える期間、未知の項目、重複した出力先、既存の数式セルへの上書きなどは拒否します。指定していないセルやシートを意図的に書き換えません。実ファイルの印刷設定・図形などの保持は、会社テンプレートを使って別途確認する必要があります。マクロ付き`.xlsm`の保持は対象外です。

S3には次を非公開で置きます。

```text
templates/attendance.xlsx
templates/attendance.mapping.json
outputs/{tid}/{oid}/{exportId}.xlsx
outputs/{tid}/{oid}/{exportId}.snapshot.json
```

マッピングファイルは次の包み形式です。`mapping`にセル対応表を入れ、`templateSha256`で対応するテンプレートのバイト列を固定します。

```json
{
  "id": "attendance",
  "version": "2026-01",
  "templateSha256": "<xlsxファイルのSHA-256（64桁の16進数）>",
  "mapping": { "version": 1, "worksheet": "勤務表", "cells": {}, "days": {} }
}
```

上の`mapping`は構造の説明です。実際には例ファイルのように出力項目・日別行を設定してください。テンプレート未設定では出力を501で止め、代わりの様式を作って成功扱いにしません。S3の出力は固定の出力IDで保存し、取得URLは短時間のみ有効です。スナップショットには氏名や作業内容も含むため、AWSの権限管理・保存期間は本番運用前に決めます。

## ローカル確認

Node.js 24と、同梱の`package-lock.json`を使用します。

```sh
npm ci --prefix backend --ignore-scripts
npm test --prefix backend
```

メモリストア、DynamoDB/S3のテスト用クライアント、合成したExcelテンプレートで、社員間の分離、競合、代休、保存と出力の検証、テンプレートの保持・拒否条件を確認します。単体テストに実AWSアカウントやMicrosoft 365のトークンは必要ありません。

## AWSを用意する順番

1. 開発用AWSアカウント、利用するIAMロール、リージョンを決めます。想定は東京`ap-northeast-1`です。DynamoDBテーブルやS3バケットを手作業で先に作る必要はありません。
2. Microsoft Entra側でAPIの登録・委任scope・アクセス対象を準備し、tenant ID、**API用**アクセストークンのaudience、scope名を確認します。既存の別アプリの設定を自動流用しません。
3. 実際の`.xlsx`テンプレートを使って対応表を作り、出力結果をExcelで確認します。テンプレート・対応表は承認した版をS3に配置します。
4. [SAMテンプレート](infra/template.yaml)を検証・ビルドして開発環境にデプロイします。このリポジトリの追加作業では、デプロイは実行していません。
5. 実社員プロフィールを管理者権限で登録し、ログイン・API接続・履歴の集計を開発環境で確認します。準備が整ってからA画面の保存先を切り替えます。

SAM CLIとDockerまたは対応するローカルNodeビルド環境を用意した後のコマンド例です。

```sh
sam validate --lint --region ap-northeast-1 --template-file backend/infra/template.yaml
sam build --template-file backend/infra/template.yaml
sam deploy --guided --region ap-northeast-1
```

`EntraTenantId`、`EntraApiAudience`、`EntraRequiredScope`、`AllowedOrigin`を実環境に合わせます。初回は`TemplateKey`と`TemplateMappingKey`を空のままデプロイし、テンプレート配置後に更新できます。APIのURLには`development`などのステージ名が含まれます。

SAMは従量課金のDynamoDB、PITR、暗号化、非公開・バージョニング付きS3、JWT認証付きHTTP API、Lambdaを定義しています。テーブルとS3バケットはスタック削除時も保持します。費用・保持データを確認してから環境を削除してください。

社員プロフィールは、実際のID・氏名・開始日を記載したJSONから明示的に作成します。以下の各値を実際の管理対象に置き換え、設定したAWS権限で実行します。既存プロフィールは上書きしません。履歴の自動インポートもしません。

```json
{
  "tenantId": "<Entra tenant UUID>",
  "employeeId": "<対象社員のEntra object UUID>",
  "attendanceStartDay": "2026-10-01",
  "employee": { "name": "<氏名>", "department": "<所属>", "id": "<社員番号>" }
}
```

```sh
AWS_REGION=ap-northeast-1 ATTENDANCE_TABLE=<テーブル名> ENTRA_TENANT_ID=<tenant UUID> npm run provision --prefix backend -- /安全な場所/profile.json
```

## フロント接続前・本番運用前に残るもの

現在の画面は月だけでなく、今期の有給、過去の未入力、グラフ、月をまたぐ代休も参照します。日別APIの1か月分をそのまま既存の全履歴に置き換えると集計を壊すため、必要な集計・関連日取得を含む接続方式を次段階で実装します。

Microsoft 365ログイン、社員の権限・退職時の扱い、既存データ移行、実テンプレート確認、会社独自休日、承認・締め後の修正、監査履歴、保存期間・復旧手順、正式な送付処理は別途必要です。今回の構成は、それらの会社ルールを推測して本番運用を開始するものではありません。

AWS仕様の参照先：

- [DynamoDBトランザクション](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
- [HTTP APIのJWT authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [SAM HttpApi Auth](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-httpapi-httpapiauth.html)
- [Lambdaランタイム](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)
