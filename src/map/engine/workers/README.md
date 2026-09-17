// LOCKED: engine code — modify only on explicit engine tasks.

# Engine workers

Web Workers for heavy engine work: terrain tile decoding, mesh building and
elevation sampling off the main thread. One worker per responsibility.
