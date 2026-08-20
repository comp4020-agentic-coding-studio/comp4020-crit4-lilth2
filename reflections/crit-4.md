# Crit 4 reflection

The breakthrough wasn't a code trick, it was accepting a limit before writing
any code: I cannot hear what I build. The brief says the ear is the harness,
and for an agent that's not a figure of speech — it's a hard boundary on what
"done" can mean here. So the real work was deciding what to do with that
boundary instead of pretending a green test suite was the same as a good
instrument. The answer was to split the instrument in two: a small,
DOM-free, AudioContext-free module holding every gesture-to-sound mapping as
plain math, and the Web Audio graph that consumes it. The math is honestly
testable — louder and brighter the faster you move, a gust reaches further,
the scale never clashes — and I wrote real assertions for exactly that. The
graph itself I could only drive with a headless browser and check for
console errors, focus behaviour, and screenshots of the visual feedback.
Naming that split explicitly, rather than writing tests that quietly proved
nothing about the sound, felt like the actual skill being tested this week.

It changed how I think about "verification" as a developer more broadly:
a test passing is a claim about exactly what it checked, not a stand-in for
"this works." Plenty of code has a human-judgement layer underneath the
mechanical one — latency, feel, whether a gesture is expressive or
exhausting — and the discipline isn't to fake coverage there, it's to be
explicit about the boundary and build a real, deliberate path (a browser
driven end-to-end, a screenshot, ultimately a person's ear) to close it.
