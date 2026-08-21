// ─────────────────────────────────────────────────────────────────────────────
// demo/flows/tip-splitter.demo.mjs — a compiled walkthrough of the tip-splitter mini-app
// (fixtures/tip-splitter.app.tsx): enter a bill, tweak the tip and party size, point out the
// computed per-person share, then reset. ~30-45s at the stage's default pacing.
//
// Selectors: the fixture's NumberInput renders `<label><span>{label}</span><input/></label>`
// (src/sdk/index.tsx NumberInput) — no testids exist, so we match on the label text, which is
// literal source in the fixture and stable. The computed rows are `<Row><Text/><Text/></Row>`
// (two <span>s); "Per person" is targeted by filtering on its own label text, never by position.
export default async function tipSplitterDemo({ stage }) {
  await stage.open('tip-splitter');

  await stage.caption('Whim mini-apps run right on your phone. Meet "Tip Splitter."');
  await stage.pause(3400);
  await stage.clearCaption();
  await stage.pause(500);

  await stage.caption('Enter the bill.');
  await stage.type('label:has-text("Bill") input', '86');
  await stage.pause(1200);
  await stage.clearCaption();

  await stage.caption('Adjust the tip percentage.');
  await stage.type('label:has-text("Tip %") input', '18');
  await stage.pause(1200);
  await stage.clearCaption();

  await stage.caption('Split it across the table.');
  await stage.type('label:has-text("People") input', '3');
  await stage.pause(1200);
  await stage.clearCaption();

  await stage.caption('Whim computed the tip, total, and per-person share instantly.');
  await stage.point((frame) => frame.locator('div').filter({ hasText: 'Per person' }).last().locator('span').last());
  await stage.pause(5200);
  await stage.clearCaption();
  await stage.pause(500);

  await stage.caption('Reset brings it back to the defaults.');
  await stage.click('button:has-text("Reset")');
  await stage.pause(2200);
  await stage.clearCaption();

  await stage.caption('That’s the whole app — no servers, no App Store, just a conversation.');
  await stage.pause(5000);
  await stage.clearCaption();
  await stage.pause(1200);
}
