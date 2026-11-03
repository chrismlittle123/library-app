export interface Sample {
  id: string;
  title: string;
  text: string;
}

const paragraphs = [
  "Woke up early and walked along the river before anything else. The water was high after the rain, and there was a heron standing perfectly still by the old bridge. I stayed longer than I meant to, which is usually a good sign.",
  "Work was mostly meetings, though the afternoon opened up and I got through the thing I'd been avoiding all week. It took about an hour. It always takes about an hour, and yet I keep treating it like a mountain.",
  "Made soup for dinner and it was better than it had any right to be. Called Sam afterwards and we talked for a long time about nothing much: the new flat, whether the band is worth keeping going, what we'd do with a free year.",
  "I've been thinking about how little of a week I actually remember. Three or four moments survive and the rest goes. Writing it down doesn't keep all of it, but it does change which moments survive.",
  "**One thing to do differently:** put the phone in another room before reading. *Twenty minutes*, that's all it takes, and the whole evening feels longer afterwards.",
];

function longEntry(bytes: number): string {
  const parts = ["# Long entry\n"];
  let size = parts[0].length;
  for (let day = 1; size < bytes; day += 1) {
    const heading = `## Part ${day}\n`;
    const body = paragraphs[(day - 1) % paragraphs.length] + "\n";
    parts.push(heading, body);
    size += heading.length + body.length + 2;
  }
  return parts.join("\n");
}

export const SAMPLES: Sample[] = [
  {
    id: "checklist",
    title: "Start here: what to test",
    text: `# What to test

These are dummy notes, and nothing leaves your phone. First add this to your home screen, because that's how the real app would run. Then try each of these:

- [ ] Write a few paragraphs, quickly, the way you normally would
- [ ] Autocorrect and suggestions above the keyboard
- [ ] Dictation
- [ ] Tap into the middle of a word and fix a typo
- [ ] Select text, then cut, copy and paste
- [ ] Does your cursor stay above the keyboard as you type?
- [ ] Does the toolbar stay on top of the keyboard?
- [ ] Rotate the phone, and switch to another app and back
- [ ] Open the 60 KB note. Does it scroll and type smoothly?
- [ ] Press **Aa** to compare styled text with hidden symbols
- [ ] Enter at the end of this list. Does it carry on?

Tell me anything that feels wrong, however small.
`,
  },
  {
    id: "diary",
    title: "Diary entry",
    text: `# Tuesday

${paragraphs[0]}

${paragraphs[1]}

${paragraphs[4]}
`,
  },
  {
    id: "recipe",
    title: "Recipe",
    text: `# Tomato soup

A quick one for a cold evening. See also [[roast-potatoes]].

## Ingredients

- 2 tins of tomatoes
- 1 onion, chopped
- 2 cloves of garlic
- A **generous** glug of olive oil

## Method

1. Soften the onion *slowly*, for about ten minutes.
2. Add the garlic, then the tomatoes.
3. Simmer for twenty minutes and blend.

> Better the next day.
`,
  },
  { id: "long", title: "Long entry (9 KB)", text: longEntry(9_000) },
  { id: "very-long", title: "Very long (60 KB)", text: longEntry(60_000) },
];
