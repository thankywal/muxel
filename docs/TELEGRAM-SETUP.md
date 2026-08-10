# Setup instructions to send over Telegram

Copy one of these and send it. They are written to be read on a phone, in a
chat, by someone who has not seen the README: short lines, no tables, no
Markdown that Telegram will not render, and every link tappable.

Each one ends at the same place, the console bot saying hello, because that is
where the guided part takes over.

**Send these as plain text.** They contain `ADMIN_BOT_TOKEN` and
`OWNER_TELEGRAM_ID`, and a client set to Markdown reads the underscores as
italics and swallows them. The reader has to type those names exactly.

Every message fits inside Telegram's 4096 character limit, so none of them
arrives split in half.

---

## English

```
Muxel sets up your own AI assistant for customers on Telegram. It runs in your own Cloudflare account. Free, no card needed, about 10 minutes.

Get these 4 things ready first.

1) A Cloudflare account
https://dash.cloudflare.com/sign-up
Confirm the email it sends you. Stay on the free plan.

2) A GitHub account
https://github.com/signup
You never write code there. It just keeps a copy so your bot can be updated.

3) Two bots from @BotFather
Send /newbot twice.
- First one is your private control panel. Call it something like My Muxel Console.
- Second one is what customers write to. Give it your shop name.
BotFather replies with a long token for each. Keep both.

4) Your Telegram number
Send /start to @userinfobot. It replies with a number. Copy it.

Now deploy.

Open this link:
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare will ask you to sign in, connect GitHub, and install the Cloudflare Workers and Pages app. Approve it.

On the form:
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine
- ADMIN_BOT_TOKEN: the FIRST bot token (the console one)
- OWNER_TELEGRAM_ID: your number from step 4

Everything else, leave as it is. Press deploy and wait.

When it finishes, open the page Cloudflare shows you. If it says your code copy is public, tap the link on that page and set the repository to Private. Takes 10 seconds.

Then open your console bot in Telegram and send /start.

It will ask you to add a business. That is where you paste the SECOND bot token, the one for customers. The business takes its name from that bot.

After that, use Add data to upload your price list or policies. PDF, Word, Excel, text, all fine.

One thing to know: after you upload, wait about a minute before testing. The search index needs a moment, and until then the assistant will say it does not know.
```

---

## မြန်မာ

```
Muxel က သင့်ဝယ်သူတွေအတွက် Telegram မှာ AI assistant တစ်ခု ဆောက်ပေးပါတယ်။ သင့်ကိုယ်ပိုင် Cloudflare account ထဲမှာ run ပါတယ်။ အခမဲ့၊ card မလို၊ ၁၀ မိနစ်ခန့်ပါ။

အရင်ဆုံး ဒီ ၄ ခု ပြင်ဆင်ပါ။

၁) Cloudflare account
https://dash.cloudflare.com/sign-up
ပို့လိုက်တဲ့ email ကို confirm လုပ်ပါ။ Free plan ပဲ ထားပါ။

၂) GitHub account
https://github.com/signup
အဲဒီမှာ code ရေးစရာ မလိုပါဘူး။ သင့် bot ကို update လုပ်လို့ရအောင် မိတ္တူ သိမ်းထားဖို့ပါ။

၃) @BotFather ကနေ bot ၂ ခု
/newbot ကို နှစ်ခါ ပို့ပါ။
- ပထမတစ်ခုက သင့်ကိုယ်ပိုင် ထိန်းချုပ်ရေး panel ပါ။ My Muxel Console လိုမျိုး နာမည်ပေးပါ။
- ဒုတိယတစ်ခုက ဝယ်သူတွေ စာရေးမယ့် bot ပါ။ သင့်ဆိုင်နာမည် ပေးပါ။
BotFather က တစ်ခုစီအတွက် token ရှည်ကြီး ပြန်ပေးပါလိမ့်မယ်။ နှစ်ခုလုံး သိမ်းထားပါ။

၄) သင့် Telegram နံပါတ်
@userinfobot ကို /start ပို့ပါ။ နံပါတ်တစ်ခု ပြန်ပေးပါလိမ့်မယ်။ ကူးထားပါ။

အခု deploy လုပ်ပါ။

ဒီ link ကို ဖွင့်ပါ:
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare က sign in လုပ်ဖို့၊ GitHub ချိတ်ဖို့၊ Cloudflare Workers and Pages app install လုပ်ဖို့ တောင်းပါလိမ့်မယ်။ Approve လုပ်ပါ။

Form မှာ:
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine
- ADMIN_BOT_TOKEN: ပထမ bot ရဲ့ token (console အတွက်)
- OWNER_TELEGRAM_ID: အဆင့် ၄ က သင့်နံပါတ်

ကျန်တာ အားလုံး မထိပါနဲ့။ Deploy နှိပ်ပြီး စောင့်ပါ။

ပြီးရင် Cloudflare ပြတဲ့ စာမျက်နှာကို ဖွင့်ပါ။ "your code copy is public" လို့ ပြရင် အဲဒီ link ကို နှိပ်ပြီး repository ကို Private ပြောင်းပါ။ ၁၀ စက္ကန့်ပဲ ကြာပါတယ်။

ပြီးရင် Telegram မှာ သင့် console bot ကို ဖွင့်ပြီး /start ပို့ပါ။

Business ထည့်ဖို့ တောင်းပါလိမ့်မယ်။ အဲဒီမှာ ဒုတိယ bot token (ဝယ်သူတွေအတွက်ဟာ) ကို ထည့်ပါ။ Business နာမည်က အဲဒီ bot ရဲ့ နာမည်အတိုင်း အလိုအလျောက် ဖြစ်သွားပါမယ်။

ပြီးရင် Add data ကနေ သင့်ဈေးနှုန်းစာရင်း ဒါမှမဟုတ် စည်းကမ်းချက်တွေ တင်ပါ။ PDF, Word, Excel, text အားလုံး ရပါတယ်။

သိထားသင့်တာ တစ်ခု: တင်ပြီးရင် တစ်မိနစ်ခန့် စောင့်ပြီးမှ စမ်းပါ။ ရှာဖွေရေး index က အချိန်အနည်းငယ် ယူပါတယ်။ အဲဒီအထိ assistant က "မသိပါ" လို့ ဖြေနေပါလိမ့်မယ်။
```

---

## ไทย

```
Muxel ช่วยตั้งผู้ช่วย AI สำหรับลูกค้าของคุณบน Telegram โดยทำงานในบัญชี Cloudflare ของคุณเอง ฟรี ไม่ต้องใช้บัตร ใช้เวลาราว 10 นาที

เตรียม 4 อย่างนี้ก่อน

1) บัญชี Cloudflare
https://dash.cloudflare.com/sign-up
ยืนยันอีเมลที่ส่งมา และใช้แผนฟรีต่อไป

2) บัญชี GitHub
https://github.com/signup
คุณไม่ต้องเขียนโค้ดที่นั่น มันเก็บสำเนาไว้เพื่อให้อัปเดตบอทได้

3) บอทสองตัวจาก @BotFather
ส่ง /newbot สองครั้ง
- ตัวแรกคือแผงควบคุมส่วนตัวของคุณ ตั้งชื่อประมาณ My Muxel Console
- ตัวที่สองคือตัวที่ลูกค้าจะทัก ใช้ชื่อร้านของคุณ
BotFather จะตอบ token ยาว ๆ มาให้ทั้งสองตัว เก็บไว้ทั้งคู่

4) หมายเลข Telegram ของคุณ
ส่ง /start ไปที่ @userinfobot แล้วคัดลอกตัวเลขที่ได้

จากนั้นเริ่ม deploy

เปิดลิงก์นี้:
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare จะให้คุณเข้าสู่ระบบ เชื่อมต่อ GitHub และติดตั้งแอป Cloudflare Workers and Pages กรุณากดอนุมัติ

ในแบบฟอร์ม:
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine
- ADMIN_BOT_TOKEN: token ของบอทตัวแรก (ตัวคอนโซล)
- OWNER_TELEGRAM_ID: ตัวเลขจากขั้นที่ 4

ที่เหลือปล่อยไว้ตามเดิม กด deploy แล้วรอ

เมื่อเสร็จ ให้เปิดหน้าที่ Cloudflare แสดง ถ้าขึ้นว่าสำเนาโค้ดของคุณเป็นสาธารณะ ให้แตะลิงก์บนหน้านั้นแล้วตั้ง repository เป็น Private ใช้เวลาแค่ 10 วินาที

จากนั้นเปิดบอทคอนโซลใน Telegram แล้วส่ง /start

ระบบจะให้คุณเพิ่มธุรกิจ ตรงนั้นให้วาง token ของบอทตัวที่สอง ตัวที่ลูกค้าใช้ ชื่อธุรกิจจะมาจากชื่อบอทตัวนั้นเอง

หลังจากนั้นใช้ Add data เพื่ออัปโหลดรายการราคาหรือเงื่อนไขของร้าน รองรับ PDF, Word, Excel และไฟล์ข้อความ

สิ่งหนึ่งที่ควรรู้: หลังอัปโหลด ให้รอราวหนึ่งนาทีก่อนทดสอบ ดัชนีค้นหาต้องใช้เวลาสักครู่ ระหว่างนั้นผู้ช่วยจะตอบว่าไม่ทราบ
```

---

## 中文

```
Muxel 帮你在 Telegram 上为客户搭建一个 AI 助手，完全运行在你自己的 Cloudflare 账户里。免费，不需要银行卡，大约 10 分钟。

先准备好这 4 样东西。

1) 一个 Cloudflare 账户
https://dash.cloudflare.com/sign-up
确认它发来的邮件，保持免费方案即可。

2) 一个 GitHub 账户
https://github.com/signup
你不需要在那里写代码，它只是保存一份副本，方便以后更新你的机器人。

3) 从 @BotFather 创建两个机器人
发送 /newbot 两次。
- 第一个是你的私人控制台，可以叫 My Muxel Console。
- 第二个是客户会联系的机器人，用你的店名。
BotFather 会分别回复一长串 token，两个都要保存。

4) 你的 Telegram 号码
给 @userinfobot 发送 /start，它会回复一个数字，复制下来。

现在开始部署。

打开这个链接：
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare 会让你登录、连接 GitHub，并安装 Cloudflare Workers and Pages 应用。请点击同意。

在表单中填写：
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine
- ADMIN_BOT_TOKEN: 第一个机器人的 token（控制台那个）
- OWNER_TELEGRAM_ID: 第 4 步得到的数字

其余保持默认。点击 deploy 然后等待。

完成后，打开 Cloudflare 显示的页面。如果上面提示你的代码副本是公开的，点击页面上的链接把仓库设为 Private，只需 10 秒。

然后在 Telegram 里打开你的控制台机器人，发送 /start。

它会让你添加一个商家。在那里粘贴第二个机器人的 token，也就是面向客户的那个。商家名称会自动取自该机器人的名字。

之后用 Add data 上传你的价格表或店铺规则。PDF、Word、Excel、文本都可以。

有一点要知道：上传之后请等约一分钟再测试。搜索索引需要一点时间，在那之前助手会回答不知道。
```

---

## 日本語

```
Muxel は、あなた自身の Cloudflare アカウントの中で動く、お客様向けの Telegram AI アシスタントです。無料で、カードは不要、10 分ほどで終わります。

まず次の 4 つを用意してください。

1) Cloudflare アカウント
https://dash.cloudflare.com/sign-up
届いたメールを確認してください。無料プランのままで大丈夫です。

2) GitHub アカウント
https://github.com/signup
コードを書く必要はありません。あとで更新できるようにコピーを保管するだけです。

3) @BotFather でボットを 2 つ
/newbot を 2 回送ってください。
- 1 つ目はあなた専用の管理画面です。My Muxel Console のような名前にしてください。
- 2 つ目はお客様が話しかけるボットです。お店の名前を付けてください。
BotFather がそれぞれ長い token を返します。両方とも保管してください。

4) あなたの Telegram 番号
@userinfobot に /start を送ると数字が返ってきます。それをコピーしてください。

では、デプロイします。

このリンクを開いてください:
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare がログイン、GitHub の連携、そして Cloudflare Workers and Pages アプリのインストールを求めてきます。承認してください。

フォームでは:
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine
- ADMIN_BOT_TOKEN: 1 つ目のボットの token（管理用）
- OWNER_TELEGRAM_ID: 手順 4 の数字

ほかはそのままで構いません。deploy を押して待ちます。

終わったら Cloudflare が表示するページを開いてください。コードのコピーが公開されていると書かれていたら、そのページのリンクからリポジトリを Private にしてください。10 秒で終わります。

そのあと Telegram で管理ボットを開き、/start を送ってください。

ビジネスの追加を求められます。そこで 2 つ目のボット、お客様向けの token を貼り付けてください。ビジネス名はそのボットの名前がそのまま使われます。

そのあとは Add data から価格表や規約をアップロードしてください。PDF、Word、Excel、テキストのいずれも使えます。

ひとつ知っておいてください。アップロードの直後は 1 分ほど待ってから試してください。検索インデックスの準備に少し時間がかかり、それまではアシスタントが「わかりません」と答えます。
```
