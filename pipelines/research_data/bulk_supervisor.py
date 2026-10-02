#!/usr/bin/env python3
"""Own both backfill phases and write a completion or failure receipt.

Run under launchd for an independently managed task. No automatic production
activation. A failed immutable input/code check exits instead of changing inputs.
"""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys
import datetime
import fcntl
import time

HERE=Path(__file__).resolve().parent
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--out',type=Path,required=True);args=parser.parse_args()
    root=args.out
    with (root/'supervisor.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:sys.exit('A supervisor already owns this run')
        execute(root)

def execute(root):
    results={}
    if (root/'execution-finished.json').exists():
        previous=json.loads((root/'execution-finished.json').read_text())
        if previous['status']=='complete_accounting':return
    def phase(role):
        with (root/(role+'.log')).open('a',buffering=1) as out:
            # Retry a failed dispatcher, keeping per-item immutable acquisition
            # outcomes and replaying only unacknowledged catalog transactions.
            for attempt in range(3):
                code=subprocess.run([sys.executable,'-u',str(HERE/'bulk.py'),'--out',str(root),'run','--role',role],stdout=out,stderr=subprocess.STDOUT).returncode
                if code==0:return 0
                if attempt<2:time.sleep(30)
            return code
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        tasks={pool.submit(phase,role):role for role in ['legacy_delivery','source_original']}
        for future in concurrent.futures.as_completed(tasks):results[tasks[future]]=future.result()
    # CLI authentication can expire during a multi-hour run. Keep its normal
    # read-only status/refresh path and bounded retries separate from acquisition.
    with (root/'production-comparison.log').open('a',buffering=1) as out:
        for attempt in range(3):
            guard=subprocess.run([sys.executable,str(HERE/'run.py'),'--out',str(root),'guard-production'],stdout=out,stderr=subprocess.STDOUT).returncode
            if guard==0:break
            if attempt<2:
                subprocess.run(['cf','auth','whoami'],stdout=subprocess.DEVNULL,stderr=out)
                time.sleep(30)
    finished={'finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'phase_exit_codes':results,'production_comparison_exit_code':guard,
              'status':'complete_accounting' if guard==0 and all(code==0 for code in results.values()) else 'needs_attention'}
    (root/'execution-finished.json').write_text(json.dumps(finished,indent=2)+'\n')
    if finished['status']!='complete_accounting' or guard:sys.exit(1)
if __name__=='__main__':main()
