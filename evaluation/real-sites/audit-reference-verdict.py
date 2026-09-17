"""Probe a pinned reference runner with stubs; no browser, LLM, or database service.

Loads the locally reviewed function, without importing/executing the repository.
This is an orchestration probe, not a competitor end-to-end accuracy benchmark.
"""
import ast
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'artifacts/benchmarks/jimmytoan-qa-agent/backend/app/services/runner.py'
COMMIT = '5be0169a6bbebd334c59fda068bf8025cd2c18bc'
source = SOURCE.read_bytes()
if hashlib.sha256(source).hexdigest() != '5679f5af3f114e5f2238fa929aae93029f5a4d6a4b06f85bb9873a1471ee7899':
    raise RuntimeError('Reference source changed; review it again before executing this probe')
tree = ast.parse(source)
function = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'run_browser_use_task')
isolated = compile(ast.Module(body=[function], type_ignores=[]), str(SOURCE), 'exec')


async def probe(success, raises=False):
    row = SimpleNamespace(status='queued', model='stub', task='Verify an explicit expected result')
    class DB:
        def __enter__(self): return self
        def __exit__(self, *args): return False
        def get(self, *args): return row
        def commit(self): pass
    class Result:
        def is_success(self): return success
        def final_result(self): return 'Expected result confirmed' if success else 'Task unsuccessful: expected result was not observed'
    class Agent:
        def __init__(self, **kwargs): pass
        async def run(self):
            if raises: raise TimeoutError('Simulated model transport timeout')
            return Result()
    browser_module = ModuleType('browser_use')
    browser_module.Agent = Agent
    browser_module.BrowserProfile = lambda **kwargs: None
    database_module = ModuleType('reference_probe.database')
    database_module.SessionLocal = DB
    sys.modules['browser_use'] = browser_module
    sys.modules['reference_probe.database'] = database_module
    namespace = dict(__package__='reference_probe.services', asyncio=asyncio, os=os,
        BrowserUseRunModel=object, RunStatus=SimpleNamespace(canceled='canceled', running='running', passed='passed', failed='failed'),
        utc_now=lambda: None, _build_llm=lambda _: object(), RUN_TASKS={}, RUN_EVENTS={},
        BROWSER_SEMAPHORE=asyncio.Semaphore(1), save_screenshot_artifact=lambda **kwargs: None,
        save_gif_artifact=lambda **kwargs: None)
    exec(isolated, namespace)
    await namespace['run_browser_use_task']('stub-run')
    return dict(agentSuccess=None if raises else success, transportException=raises,
                storedStatus=row.status, result=getattr(row, 'result', None), error=getattr(row, 'error', None))


async def main():
    rows = [await probe(True), await probe(False), await probe(False, raises=True)]
    assert [r['storedStatus'] for r in rows] == ['passed', 'passed', 'failed']
    output = dict(repository='https://github.com/jimmytoan/qa-agent', reviewedCommit=COMMIT,
        sourceSha256=hashlib.sha256(source).hexdigest(), function='run_browser_use_task',
        scope='Extracted source function with stubbed agent, storage, artifacts and model. Not a full product evaluation.',
        externalAiCalls=0, browserCalls=0, cases=rows)
    destination = ROOT / 'docs/evidence/qa-reference-audit/jimmytoan-verdict.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(output, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
