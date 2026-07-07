# Apache Beam Execution Model & CSV Parsing

This document details an important architectural lesson learned while building the `CSV Source` node code generator, specifically regarding Apache Beam's distributed execution model and stateful `DoFn` lifecycle.

## The Problem: The Disappearing Data
During testing, a pipeline containing `[CSV Source] -> [Filter]` would consistently output **0 rows** during execution, despite the `CSV Source` preview working perfectly in isolation.

The original Python code generator for `CSV Source` attempted to parse headers using a stateful `DoFn`:

```python
class Parse_CSV(beam.DoFn):
    def __init__(self):
        self.header = None

    def process(self, element):
        reader = csv.reader(io.StringIO(element), delimiter=',')
        for row in reader:
            if self.header is None:
                self.header = [h.strip().lstrip('\ufeff') for h in row]
                continue
            clean_row = [v.strip() if isinstance(v, str) else v for v in row]
            yield dict(zip(self.header, clean_row))
```

### Why this Failed
Apache Beam is a distributed processing framework. It makes **zero guarantees** about the lifecycle of a `DoFn` instance or the bundling of elements:
1. `ReadFromText` reads the file and emits individual lines as completely independent elements.
2. The execution engine (like `DirectRunner` or Dataflow) bundles these elements into arbitrary batches.
3. The engine may instantiate a brand new `Parse_CSV` object (where `self.header = None`) for each bundle, or even for each individual element depending on fusion and parallelization strategies.

When the `Filter` node was attached, the execution engine altered its bundling strategy. It began treating every single line as a separate bundle/execution context. Because `self.header` was `None` at the start of every context, **every single line in the CSV was treated as a "header" and skipped**. The node produced 0 rows.

## The Solution: Stateless Execution
To reliably parse CSV headers in a distributed Apache Beam pipeline, you cannot rely on state persisting across elements. The header must be extracted independently and passed as a static parameter to all parallel workers.

The correct approach used by BeamFlow is to:
1. Read only the very first line of the file locally (using `FileSystems` to support both local and remote cloud buckets like GCS/S3).
2. Clean the header (including stripping invisible Byte Order Marks like `\ufeff` that Windows Excel often adds).
3. Use `ReadFromText(..., skip_header_lines=1)` to stream the rest of the file.
4. Pass the extracted header into a stateless `FlatMap` via side-arguments.

```python
# 1. Read CSV header locally first to avoid distributed parsing issues
with FileSystems.open(filePath) as f:
    wrapper = io.TextIOWrapper(f, encoding='utf-8')
    reader = csv.reader(wrapper, delimiter=',')
    raw_header = next(reader)
    # 2. Strip whitespace and invisible BOMs
    header = [h.strip().lstrip('\ufeff') for h in raw_header]

# 3. Read lines skipping the header
raw_lines = p | ReadFromText(filePath, skip_header_lines=1)

def parse_csv(element, header_cols):
    reader = csv.reader(io.StringIO(element), delimiter=',')
    for row in reader:
        clean_row = [v.strip() if isinstance(v, str) else v for v in row]
        # 4. Zip with the globally distributed header
        yield dict(zip(header_cols, clean_row))

# Pass header_cols statically to all workers
parsed = raw_lines | beam.FlatMap(parse_csv, header_cols=header)
```

## Key Takeaways
1. **Never use `self.xxx` in a `beam.DoFn` to accumulate state across elements** unless you are using the explicit Stateful Processing API (State/Timers).
2. **Byte Order Marks (`\ufeff`)** are invisible but will break dictionary key lookups. Always `.lstrip('\ufeff')` when reading headers from unknown CSV sources.
3. Local test runs that "happen to work" in a single bundle (like the isolated CSV preview did) can mask catastrophic distributed processing bugs.
