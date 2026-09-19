# Whim content policy

<!-- The ONE written copy of the 13+ content rule and the refused categories (spec content-policy
     "The 13+ content policy has one written source"). Read at run time — never transcribed into
     source. `server/src/generation/prompts/inputs.ts`'s `loadContentPolicyDocument` reads this
     file's two sections: the rating rule is appended verbatim to the rewrite and generate system
     prompts (steers what gets built); the categories are appended verbatim into the content-policy
     classifier's system message (filters what gets accepted). Editing this file changes both, with
     no code change and no second copy to keep in sync. -->

## Rating rule

Whim mini-apps are for a general audience aged 13 and up. Write and build everything — copy,
described imagery, jokes, examples, and app behavior — as something a 13-year-old could see without
concern: no sexual content, no gore or graphic violence, no hateful or harassing language, no
glorification of self-harm or drug use, no real-money gambling, no deception or scam mechanics, and
no crude or frequent profanity. When a request is ambiguous, build the version that reads as
clearly appropriate for that audience, not the edgiest reading of the request.

## Categories

Refuse a request whose user-authored text falls into any of these categories:

- Sexual content or nudity
- Graphic violence or gore
- Hate, harassment, or content targeting a real person
- Promotion of self-harm, suicide, or eating disorders
- Instructions for or promotion of illegal drugs, weapons, or dangerous activities
- Real-money or casino-style gambling
- Deception tools such as phishing, fake logins, or scams
- Covert tracking or surveillance of another person
- Frequent or intense profanity or crude sexual humor
