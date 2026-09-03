# Setup instructions to send in a chat

Copy one of these and send it. They are written to be read on a phone, in a
chat, by someone who has not seen the README: short lines, no tables, no
Markdown that Telegram will not render, and every link tappable.

Each one ends at the same place, the console open in their browser, because
that is where the guided part takes over. Telegram is at the bottom of every
one of them, as something to add afterwards, because setup no longer needs it
and the person you are helping may not have an account at all. Nothing before
the deploy asks them to invent anything: the deployment issues its own console
key and shows it on the page they open next.

**Send these as plain text.** They contain `ADMIN_BOT_TOKEN` and
`OWNER_TELEGRAM_ID`, and a client set to Markdown reads the underscores as
italics and swallows them. The reader has to type those names exactly.

Every message fits inside Telegram's 4096 character limit, so none of them
arrives split in half.

---

## English

```
Muxel sets up your own AI assistant for your customers. It runs in your own Cloudflare account. Free, no card needed, about 10 minutes.

Get these 2 things ready first.

1) A Cloudflare account
https://dash.cloudflare.com/sign-up
Confirm the email it sends you. Stay on the free plan.

2) A GitHub account
https://github.com/signup
You never write code there. It just keeps a copy so your assistant can be updated.

Now deploy.

Open this link:
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare will ask you to sign in, connect GitHub, and install its GitHub app. Approve it.

On the form:
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine

Everything else, leave as it is. Press deploy and wait.

When it finishes, open the page Cloudflare shows you. If it says your code copy is public, tap the link on that page and set the repository to Private. Takes 10 seconds.

That page also shows your console key, a long random string your deployment made for itself. Copy it and keep it safe: the page stops showing it once you have signed in.

Copy the address of that page too. Then open https://app.muxel.site, paste the address in, and paste the key. That is your console.

It will ask you to add a business. Give it the name of your shop.

After that, use Add data to upload your price list or policies. PDF, Word, Excel, text, all fine.

One thing to know: after you upload, wait about a minute before testing. The search index needs a moment, and until then the assistant will say it does not know.

Want it on Telegram too? Add it any day you like. Nothing you set up before it is lost.
- Send /newbot to @BotFather. The token it gives you is the bot your customers write to. Paste it into the console, on that business.
- To drive the console from Telegram as well, make a second bot with /newbot, send /start to @userinfobot for your number, and put the two into your Worker under Settings, Variables and Secrets, as ADMIN_BOT_TOKEN and OWNER_TELEGRAM_ID.
```

---

## မြန်မာ

```
Muxel က သင့်ဝယ်သူတွေအတွက် AI assistant တစ်ခု ဆောက်ပေးပါတယ်။ သင့်ကိုယ်ပိုင် Cloudflare account ထဲမှာ run ပါတယ်။ အခမဲ့၊ card မလို၊ ၁၀ မိနစ်ခန့်ပါ။

အရင်ဆုံး ဒီ ၂ ခု ပြင်ဆင်ပါ။

၁) Cloudflare account
https://dash.cloudflare.com/sign-up
ပို့လိုက်တဲ့ email ကို confirm လုပ်ပါ။ Free plan ပဲ ထားပါ။

၂) GitHub account
https://github.com/signup
အဲဒီမှာ code ရေးစရာ မလိုပါဘူး။ သင့် assistant ကို update လုပ်လို့ရအောင် မိတ္တူ သိမ်းထားဖို့ပါ။

အခု deploy လုပ်ပါ။

ဒီ link ကို ဖွင့်ပါ:
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare က sign in လုပ်ဖို့၊ GitHub ချိတ်ဖို့၊ သူ့ GitHub app ကို install လုပ်ဖို့ တောင်းပါလိမ့်မယ်။ Approve လုပ်ပါ။

Form မှာ:
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine

ကျန်တာ အားလုံး မထိပါနဲ့။ Deploy နှိပ်ပြီး စောင့်ပါ။

ပြီးရင် Cloudflare ပြတဲ့ စာမျက်နှာကို ဖွင့်ပါ။ "your code copy is public" လို့ ပြရင် အဲဒီ link ကို နှိပ်ပြီး repository ကို Private ပြောင်းပါ။ ၁၀ စက္ကန့်ပဲ ကြာပါတယ်။

အဲဒီ စာမျက်နှာမှာ သင့် console key ကိုပါ ပြပါလိမ့်မယ်။ deployment ကိုယ်တိုင် ဆောက်ထားတဲ့ ကျပန်း စာလုံးရှည်တစ်ခုပါ။ ကူးယူပြီး သေချာသိမ်းထားပါ။ တစ်ခါ ဝင်ပြီးရင် အဲဒီစာမျက်နှာက ပြတော့မှာ မဟုတ်ပါဘူး။

စာမျက်နှာရဲ့ လိပ်စာကိုလည်း ကူးယူပါ။ ပြီးရင် https://app.muxel.site ကို ဖွင့်ပြီး လိပ်စာနဲ့ key ကို ကူးထည့်ပါ။ အဲဒါ သင့် console ပါ။

Business တစ်ခု ထည့်ဖို့ တောင်းပါလိမ့်မယ်။ သင့်ဆိုင်နာမည်ကို ပေးလိုက်ပါ။

ပြီးရင် Add data ကနေ သင့်ဈေးနှုန်းစာရင်း ဒါမှမဟုတ် စည်းကမ်းချက်တွေ တင်ပါ။ PDF, Word, Excel, text အားလုံး ရပါတယ်။

သိထားသင့်တာ တစ်ခု: တင်ပြီးရင် တစ်မိနစ်ခန့် စောင့်ပြီးမှ စမ်းပါ။ ရှာဖွေရေး index က အချိန်အနည်းငယ် ယူပါတယ်။ အဲဒီအထိ assistant က "မသိပါ" လို့ ဖြေနေပါလိမ့်မယ်။

Telegram ပေါ်မှာပါ လိုချင်ပါသလား။ ဘယ်အချိန်မဆို ထပ်ထည့်လို့ ရပါတယ်။ အရင်က ပြင်ဆင်ထားသမျှ ဘာမှ မပျောက်ပါဘူး။
- @BotFather ကို /newbot ပို့ပါ။ ရလာတဲ့ token က ဝယ်သူတွေ စာရေးမယ့် bot ပါ။ console ထဲမှာ အဲဒီ business အောက်တွင် ထည့်ပါ။
- Telegram ကနေပါ console ကို ကိုင်တွယ်ချင်ရင် /newbot နဲ့ ဒုတိယ bot တစ်ခု ဆောက်ပါ။ @userinfobot ကို /start ပို့ပြီး သင့်နံပါတ်ကို ယူပါ။ ပြီးရင် Worker ရဲ့ Settings, Variables and Secrets မှာ ADMIN_BOT_TOKEN နဲ့ OWNER_TELEGRAM_ID အဖြစ် ထည့်ပါ။
```

---

## ไทย

```
Muxel ช่วยตั้งผู้ช่วย AI สำหรับลูกค้าของคุณ โดยทำงานในบัญชี Cloudflare ของคุณเอง ฟรี ไม่ต้องใช้บัตร ใช้เวลาราว 10 นาที

เตรียม 2 อย่างนี้ก่อน

1) บัญชี Cloudflare
https://dash.cloudflare.com/sign-up
ยืนยันอีเมลที่ส่งมา และใช้แผนฟรีต่อไป

2) บัญชี GitHub
https://github.com/signup
คุณไม่ต้องเขียนโค้ดที่นั่น มันเก็บสำเนาไว้เพื่อให้อัปเดตผู้ช่วยของคุณได้

จากนั้นเริ่ม deploy

เปิดลิงก์นี้:
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare จะให้คุณเข้าสู่ระบบ เชื่อมต่อ GitHub และติดตั้งแอป GitHub ของ Cloudflare กรุณากดอนุมัติ

ในแบบฟอร์ม:
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine

ที่เหลือปล่อยไว้ตามเดิม กด deploy แล้วรอ

เมื่อเสร็จ ให้เปิดหน้าที่ Cloudflare แสดง ถ้าขึ้นว่าสำเนาโค้ดของคุณเป็นสาธารณะ ให้แตะลิงก์บนหน้านั้นแล้วตั้ง repository เป็น Private ใช้เวลาแค่ 10 วินาที

หน้านั้นจะแสดงรหัสคอนโซลของคุณด้วย เป็นสตริงสุ่มยาว ๆ ที่ deployment สร้างขึ้นเอง คัดลอกไว้และเก็บให้ดี เพราะหน้านั้นจะหยุดแสดงเมื่อคุณเข้าสู่ระบบครั้งแรกแล้ว

คัดลอกที่อยู่ของหน้านั้นไว้ด้วย แล้วเปิด https://app.muxel.site วางที่อยู่ลงไป และวางรหัสนั้น นั่นคือคอนโซลของคุณ

ระบบจะให้คุณเพิ่มธุรกิจ ใส่ชื่อร้านของคุณลงไป

หลังจากนั้นใช้ Add data เพื่ออัปโหลดรายการราคาหรือเงื่อนไขของร้าน รองรับ PDF, Word, Excel และไฟล์ข้อความ

สิ่งหนึ่งที่ควรรู้: หลังอัปโหลด ให้รอราวหนึ่งนาทีก่อนทดสอบ ดัชนีค้นหาต้องใช้เวลาสักครู่ ระหว่างนั้นผู้ช่วยจะตอบว่าไม่ทราบ

อยากให้อยู่บน Telegram ด้วยไหม เพิ่มวันไหนก็ได้ และสิ่งที่ตั้งไว้ก่อนหน้าจะไม่หายไป
- ส่ง /newbot ไปที่ @BotFather token ที่ได้คือบอทที่ลูกค้าจะทัก นำไปวางในคอนโซล ที่ธุรกิจนั้น
- ถ้าอยากสั่งงานคอนโซลจาก Telegram ด้วย ให้สร้างบอทตัวที่สองด้วย /newbot ส่ง /start ไปที่ @userinfobot เพื่อเอาหมายเลขของคุณ แล้วใส่ทั้งสองค่าลงใน Worker ที่ Settings, Variables and Secrets เป็น ADMIN_BOT_TOKEN และ OWNER_TELEGRAM_ID
```

---

## 中文

```
Muxel 帮你为客户搭建一个 AI 助手，完全运行在你自己的 Cloudflare 账户里。免费，不需要银行卡，大约 10 分钟。

先准备好这 2 样东西。

1) 一个 Cloudflare 账户
https://dash.cloudflare.com/sign-up
确认它发来的邮件，保持免费方案即可。

2) 一个 GitHub 账户
https://github.com/signup
你不需要在那里写代码，它只是保存一份副本，方便以后更新你的助手。

现在开始部署。

打开这个链接：
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare 会让你登录、连接 GitHub，并安装它的 GitHub 应用。请点击同意。

在表单中填写：
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine

其余保持默认。点击 deploy 然后等待。

完成后，打开 Cloudflare 显示的页面。如果上面提示你的代码副本是公开的，点击页面上的链接把仓库设为 Private，只需 10 秒。

那个页面上还会显示你的控制台密钥，是你的部署自己生成的一串长随机字符。复制下来好好保存：你第一次登录之后，那个页面就不再显示它了。

把那个页面的地址也复制下来。然后打开 https://app.muxel.site，把地址粘贴进去，再把密钥粘贴进去。那就是你的控制台。

它会让你添加一个商家，填你的店名就行。

之后用 Add data 上传你的价格表或店铺规则。PDF、Word、Excel、文本都可以。

有一点要知道：上传之后请等约一分钟再测试。搜索索引需要一点时间，在那之前助手会回答不知道。

也想放到 Telegram 上吗？任何时候都可以加，之前设置好的东西都不会丢。
- 给 @BotFather 发送 /newbot，它给你的 token 就是客户联系的机器人，在控制台里把它添加到那个商家上。
- 如果还想从 Telegram 操作控制台，用 /newbot 再建第二个机器人，给 @userinfobot 发送 /start 取得你的号码，然后在 Worker 的 Settings, Variables and Secrets 里填成 ADMIN_BOT_TOKEN 和 OWNER_TELEGRAM_ID。
```

---

## 日本語

```
Muxel は、あなた自身の Cloudflare アカウントの中で動く、お客様向けの AI アシスタントです。無料で、カードは不要、10 分ほどで終わります。

まず次の 2 つを用意してください。

1) Cloudflare アカウント
https://dash.cloudflare.com/sign-up
届いたメールを確認してください。無料プランのままで大丈夫です。

2) GitHub アカウント
https://github.com/signup
コードを書く必要はありません。あとで更新できるようにコピーを保管するだけです。

では、デプロイします。

このリンクを開いてください:
https://deploy.workers.cloudflare.com/?url=https://github.com/thankywal/muxel

Cloudflare がログイン、GitHub の連携、そして GitHub アプリのインストールを求めてきます。承認してください。

フォームでは:
- Vectorize Dimensions: 1024
- Vectorize Metric: cosine

ほかはそのままで構いません。deploy を押して待ちます。

終わったら Cloudflare が表示するページを開いてください。コードのコピーが公開されていると書かれていたら、そのページのリンクからリポジトリを Private にしてください。10 秒で終わります。

そのページには、deployment が自分で作った長いランダムなコンソールキーも表示されます。コピーして大切に保管してください。一度サインインすると、そのページはもう表示しなくなります。

そのページのアドレスもコピーします。次に https://app.muxel.site を開き、アドレスとキーを貼り付けてください。それがあなたのコンソールです。

ビジネスの追加を求められます。お店の名前を入れてください。

そのあとは Add data から価格表や規約をアップロードしてください。PDF、Word、Excel、テキストのいずれも使えます。

ひとつ知っておいてください。アップロードの直後は 1 分ほど待ってから試してください。検索インデックスの準備に少し時間がかかり、それまではアシスタントが「わかりません」と答えます。

Telegram でも使いたいですか。いつ追加しても構いませんし、先に設定したものは何も失われません。
- @BotFather に /newbot を送ると token が返ります。それがお客様の話しかけるボットです。コンソールでそのビジネスに追加してください。
- コンソール自体を Telegram から操作したい場合は、/newbot でもう 1 つボットを作り、@userinfobot に /start を送って自分の番号を調べ、Worker の Settings, Variables and Secrets に ADMIN_BOT_TOKEN と OWNER_TELEGRAM_ID として入れてください。
```
