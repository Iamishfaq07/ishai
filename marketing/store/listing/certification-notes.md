# Submission options: certification notes and restricted capabilities

Partner Center → the submission → **Submission options**.

## Restricted capabilities (required: the package declares `runFullTrust`)

Microsoft: "For each capability, tell us why your app needs to declare the capability and how it is used." The box
may be limited to about 500 characters, so this text is 455:

```text
runFullTrust: Orbit is a desktop (Win32) app, the same program as our direct download, packaged as MSIX. It needs full trust to capture the user's microphone and the meeting app's audio with WASAPI (including per-app loopback), register the keyboard shortcuts the user sets, keep the sign-in token in Windows Credential Manager, and show its always-on-top window and screenshot selector. It installs no services or drivers and never asks for admin rights.
```

## Notes for certification

Fill in the reviewer account first. The owner creates it on orbitanswer.com; sign-up is behind Turnstile, so a
reviewer can't make one. Give it enough interview minutes for a few sessions. Policy 10.3.1: "If your product requires
login credentials, provide us with a working demo account using the Notes for certification field."

```text
Orbit AI Career Assistant is a desktop (Win32, full trust) app built with Tauri and Microsoft Edge WebView2. It needs an internet connection and an Orbit account.

Reviewer account (has interview minutes; please don't change its password or turn on two-step sign-in):
  Email: <reviewer email>
  Password: <reviewer password>

How to test:
1. Open the app and sign in with the account above.
2. Practice: Home > start a mock interview (or Setup > "Mock interview - the AI asks, you practise") > Start. The AI interviewer asks a question; answer out loud. End the session, then open History > the session > Review.
3. Live help: Setup > choose "Interview", your microphone, and under "Interviewer audio source" pick an app that is playing sound (for example a browser playing any interview video) or "Everything an output plays". Start Session. Orbit transcribes the audio and shows short answer notes; the notes are for the user to read.
4. Screenshot question: during a session, press the screenshot button and drag over part of the screen; Orbit answers about that area.
5. Resume AI and Jobs AI open on our website in the default browser with the same account (Settings has the buttons); LinkedIn AI and video interviews with Saba are on the same website.

Microphone and audio: used only during a session the user starts. Audio is streamed to our server for transcription and is never stored. Windows' microphone privacy settings apply.

Purchases: none inside the app. Buttons such as "Buy minutes" open our website's billing page, where payment is through Razorpay (India) or PayPal (elsewhere). Declared under Properties.

Generative AI: answer notes, interview questions and reviews come from a cloud AI model. Users can rate any answer with thumbs up or down and report problems through the Contact page on our website; we review those reports.

Updates: the Store copy detects its package identity and turns off the app's own updater, so updates come only from the Microsoft Store.

Window privacy (an optional setting, off by default): the first time Home opens, it asks once whether to turn it on, with "Turn on the privacy shield" and "Leave it off" (nothing preselected); it can be changed any time in Settings > Window privacy. When on, Orbit asks Windows (SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE) to keep its own window out of screenshots, screen recordings and Windows Recall on the user's PC. As with any use of that Windows setting, capture by other apps, including screen sharing, leaves the window out too. It doesn't hide Orbit from Task Manager, the taskbar (a separate "Hide from the taskbar" switch, also off by default) or anyone looking at the screen, and the app makes no claim to be undetectable. Our terms ask users to use Orbit only where assistance is allowed and not to transcribe people without telling them where the law requires it.

Use where allowed: the listing and the app say that Orbit is for practice and for interviews and calls where notes or AI help are allowed.
```

**Why the window-privacy paragraph says "screen sharing" plainly.** The certification guidance asks for "Steps to
access hidden or locked features: Briefly describe how testers can access any features, modes, or content that might
not be obvious"
(<https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options>).

A reviewer who finds the screen-sharing effect on their own, after notes that left it out, has a reason to call the
listing misleading (policy 10.1.1). Saying it up front, as a side effect of a privacy setting, is the truthful
version. If you'd rather say less, discuss it with the agent that prepared this; don't just delete the sentence.

**Publishing hold:** choose **"Don't publish this submission until I select Publish now"**. You choose when it goes
live, after the private-audience check.
