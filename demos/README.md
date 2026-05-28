# Generated demos

This directory holds **locally generated** HTML and JSON reports (gitignored except this README).

## Generate demos

```bash
# Example: HTML report for one construct
python3 tracer/cli.py --output demos/02_do_concurrent.html 02_do_concurrent

# JSON export
python3 tracer/cli.py --json 06_polymorphism > demos/06_polymorphism.json
```

Files here are not committed — regenerate on any machine with the tracer CLI.
