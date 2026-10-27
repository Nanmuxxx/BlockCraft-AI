"""All execution policies and model outputs here are MOCK fixtures, never approvals."""
import concurrent.futures
import copy
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.supervisor_v2.runtime import (ChatGPTCodex, GateError, load_backend, independently_verify,
    receipt_failures, run_worker, supervisor_round, validate_schema, command)
from tools.supervisor_v2.security import ExecutionPolicy, REQUIRED_CAPABILITIES, digest_file, private_json
from tools.supervisor_v2.offline_jail import profile, probe
import test_runtime as fixtures


class AcceptanceTests(unittest.TestCase):
    setUp = fixtures.RuntimeTests.setUp
    tearDown = fixtures.RuntimeTests.tearDown
    git = fixtures.RuntimeTests.git
    task = fixtures.RuntimeTests.task
    allocated = fixtures.RuntimeTests.allocated
    row = fixtures.RuntimeTests.row

    def completed(self):
        t, w = self.allocated()
        run_worker(self.store, w, self.repo, once=True)
        return t, w, self.row(t)

    def rehash(self, report):
        report = dict(report); report.pop('artifact_sha256', None)
        report['artifact_sha256'] = hashlib.sha256(json.dumps(report, sort_keys=True).encode()).hexdigest()
        return report

    def test_rehashed_forged_receipts_still_rejected(self):
        _, _, task = self.completed(); original = json.loads(task['report'])
        changes = [('identity', lambda r: r.update(worker_id='another-worker')),
                   ('session', lambda r: r.update(session='another-session')),
                   ('missing-check', lambda r: r.update(commands=[])),
                   ('failed-check', lambda r: r['commands'][0].update(exit_code=1)),
                   ('fake-sha-output', lambda r: r['commands'][0].update(stdout='a'*40)),
                   ('dirty', lambda r: r['commands'][1].update(stdout=' M fixture.txt')),
                   ('PR-claim', lambda r: r.update(pr='https://example.invalid/pr/1')),
                   ('model-label', lambda r: r.update(classification='LOCAL_RUNTIME_CHATGPT_MODEL'))]
        for label, mutate in changes:
            with self.subTest(label=label):
                report = copy.deepcopy(original); mutate(report)
                fake = dict(task, report=json.dumps(self.rehash(report)))
                self.assertFalse(independently_verify(self.repo, fake)['passed'])

    def test_malformed_receipt_never_becomes_pass(self):
        _, _, task = self.completed()
        for report in ('{}', '[]', 'null', 'not JSON'):
            with self.subTest(report=report):
                self.assertFalse(independently_verify(self.repo, dict(task, report=report))['passed'])

    def test_offline_report_cannot_be_relabeled_model_success(self):
        _, _, task = self.completed(); report = json.loads(task['report'])
        spec = json.loads(task['spec']); spec['kind'] = 'codex-audit'
        task['spec'] = json.dumps(spec)
        self.assertTrue(receipt_failures(task, report))

    def test_worker_model_failure_has_blocked_state_and_no_receipt(self):
        t, w = self.allocated(kind='codex-audit')
        backend = ChatGPTCodex('/not/installed','/not/installed','fixture-model','/not/auth')
        with self.assertRaisesRegex(GateError, 'owner model grant'):
            run_worker(self.store, w, self.repo, once=True, codex=backend)
        self.assertEqual(self.row(t)['state'], 'BLOCKED')
        self.assertIsNone(self.row(t)['report'])

    def test_mock_events_are_explicitly_labeled(self):
        t, w, _ = self.completed()
        class Mock:
            def decide(_, context): return {'action':'ACCEPT','task_id':t,'worker_id':w,'reason':'MOCK independent clean snapshot only'}
        supervisor_round(self.store, self.repo, Mock())
        accepted = [x for x in self.store.snapshot()['events'] if x['new']=='ACCEPTED']
        self.assertEqual(accepted[0]['actor'], 'Supervisor/MOCK')

    def test_broken_review_does_not_prevent_independent_assignment(self):
        t, w, _ = self.completed()
        ready = self.task(files=['docs/unrelated']); worker = self.store.register('independent')
        class Mock:
            def decide(_, context):
                assert not context['independent_reviews'][t]['passed']
                return {'action':'ASSIGN','task_id':ready,'worker_id':worker,'reason':'MOCK unrelated task remains safe to assign'}
        with patch('tools.supervisor_v2.runtime.independently_verify', side_effect=GateError('missing object')):
            supervisor_round(self.store, self.repo, Mock())
        self.assertEqual(self.row(ready)['worker'], worker)
        self.assertEqual(self.row(t)['state'], 'REVIEW')

    @unittest.skipIf(os.name == 'nt', 'full Windows process-tree cleanup NOT_VERIFIED')
    def test_parent_exit_with_background_output_is_not_success(self):
        home=self.root/'process-home';home.mkdir()
        script="import subprocess,sys;subprocess.Popen([sys.executable,'-c','import time;time.sleep(15)'])"
        with self.assertRaisesRegex(GateError,'descendant output handles'):
            command([sys.executable,'-c',script],self.root,home,timeout=10)

    def test_source_head_change_during_model_review_rejects_acceptance(self):
        t,w,_=self.completed()
        class Mock:
            def decide(_,context):
                (self.repo/'fixture.txt').write_text('changed during review')
                self.git('add','.');self.git('commit','-qm','new HEAD during review')
                return {'action':'ACCEPT','task_id':t,'worker_id':w,'reason':'stale MOCK decision must not apply'}
        with self.assertRaisesRegex(GateError,'changed during model review'):
            supervisor_round(self.store,self.repo,Mock())
        self.assertEqual(self.row(t)['state'],'REVIEW')

    def model_receipt_fixture(self):
        t,w,task=self.completed()
        spec=json.loads(task['spec']);spec['kind']='codex-audit'
        report=json.loads(task['report']);report['classification']='LOCAL_RUNTIME_CHATGPT_MODEL'
        output={'findings':'MOCK artifact; never actual AI evidence'}
        model={'exit_code':0,'answer':output,'model_status':'COMPLETED',
               'classification':'LOCAL_RUNTIME_CHATGPT_MODEL','model_session_id':'MOCK-worker-thread',
               'execution_id':'MOCK-worker-execution',
               'artifact_sha256':hashlib.sha256(json.dumps(output,sort_keys=True).encode()).hexdigest()}
        report['commands'].insert(0,model);report=self.rehash(report)
        with self.store.tx() as c:
            c.execute('UPDATE tasks SET spec=?,report=? WHERE id=?',(json.dumps(spec),json.dumps(report),t))
        return t,w,self.row(t)

    def test_mock_cannot_accept_even_structurally_valid_model_receipt(self):
        t,w,task=self.model_receipt_fixture()
        class Mock:
            def decide(_,context):return {'action':'ACCEPT','task_id':t,'worker_id':w,'reason':'pretend successful real model review'}
        with self.assertRaisesRegex(GateError,'real Codex QA session'):
            supervisor_round(self.store,self.repo,Mock())
        self.assertEqual(self.row(t)['state'],'REVIEW')

    def test_same_session_or_different_receipt_qa_cannot_accept(self):
        t,w,task=self.model_receipt_fixture()
        reviewer=ChatGPTCodex('/not-installed','/not-installed','fixture-model','/auth-not-read')
        proof={'classification':'LOCAL_RUNTIME_CHATGPT_MODEL','model_status':'COMPLETED',
               'subjects':{t:hashlib.sha256(task['report'].encode()).hexdigest()},
               'execution_id':'MOCK-different-execution','model_session_id':'MOCK-worker-thread'}
        decision={'action':'ACCEPT','task_id':t,'worker_id':w,'reason':'MOCK must be rejected despite pass claim'}
        reviewer.last_review=proof
        with patch.object(reviewer,'decide',return_value=decision):
            with self.assertRaisesRegex(GateError,'self-review'):
                supervisor_round(self.store,self.repo,reviewer)
        reviewer.last_review=dict(proof,model_session_id='MOCK-QA-thread',subjects={t:'wrong-receipt'})
        with patch.object(reviewer,'decide',return_value=decision):
            with self.assertRaisesRegex(GateError,'different receipt'):
                supervisor_round(self.store,self.repo,reviewer)
        self.assertEqual(self.row(t)['state'],'REVIEW')


@unittest.skipIf(os.name == 'nt', 'Windows live-model ACL/process tree boundary intentionally NOT_VERIFIED')
class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name).resolve()
        self.control = self.root/'operator'; self.control.mkdir(mode=0o700)
        self.repo = self.root/'repo'; self.repo.mkdir()
        self.work = self.root/'work'; self.work.mkdir()
        self.home = self.root/'clean-home'; self.home.mkdir()
        self.fake_cli = self.control/'fake-codex'; self.fake_cli.write_text('MOCK marker'); self.fake_cli.chmod(0o700)
        self.launcher = self.control/'fake-launcher'; self.launcher.write_text('MOCK marker'); self.launcher.chmod(0o700)
        self.grant_file, self.qa_file = self.control/'grant.json', self.control/'qa.json'
        self.profile_file=self.control/'profile.json';self.profile_file.write_text('{"classification":"MOCK fixture only"}');self.profile_file.chmod(0o600)
        self.grant = {'backend':'codex-chatgpt-exec','auth':'existing-local-chatgpt','approval_ref':'MOCK fixture only',
            'approved_by':'MOCK-owner','model':'fixture-model','roles':['worker','supervisor'],
            'valid_until':time.time()+3600,'max_runs':2,'timeout_seconds':10,
            'max_additional_api_spend_usd':0,'allow_credit_purchase':False,'auth_home':str(self.root/'auth-not-read')}
        self.qa = {'status':'PASS','classification':'INDEPENDENT_OFFLINE_ISOLATION_QA','reviewer':'MOCK-QA',
            'platform':platform.system(),'valid_until':time.time()+3600,'capabilities':sorted(REQUIRED_CAPABILITIES),
            'live_auth_boundary_verified':True,'evidence_ref':'MOCK fixture only','profile_sha256':digest_file(self.profile_file),'profile_file':str(self.profile_file),
            'launcher_sha256':digest_file(self.launcher),'runtime_sha256':digest_file(self.fake_cli)}
        self.write()
        self.policy = ExecutionPolicy(self.repo,self.grant_file,self.qa_file,self.launcher,self.fake_cli,
                                      self.grant['auth_home'],'fixture-model')
        self.adapter = ChatGPTCodex(str(self.fake_cli),str(self.launcher),'fixture-model',self.grant['auth_home'],
                                   str(self.grant_file),str(self.qa_file))
        self.pulses = 0

    def tearDown(self): self.tmp.cleanup()
    def write(self):
        for path, data in ((self.grant_file,self.grant),(self.qa_file,self.qa)):
            path.write_text(json.dumps(data)); path.chmod(0o600)

    def fake_command(self, argv, cwd, home, pulse=lambda:None, **kwargs):
        pulse()
        env = kwargs['trusted_env']
        self.assertEqual(env['CODEX_HOME'], self.grant['auth_home'])
        for key in ('GH_TOKEN','GITHUB_TOKEN','OPENAI_API_KEY','CODEX_API_KEY','CODEX_ACCESS_TOKEN','SSH_AUTH_SOCK'):
            self.assertNotIn(key, env)
        base = {'argv':argv,'exit_code':0,'stdout':'','stderr':'','started_at':time.time(),'finished_at':time.time()}
        if argv[-2:]==['login','status']:
            base['stderr']='Logged in using ChatGPT\n'; return base
        self.assertNotIn('--oss',argv); self.assertNotIn('--local-provider',argv)
        self.assertIn('forced_login_method="chatgpt"',argv)
        answer = Path(argv[argv.index('--output-last-message')+1])
        answer.write_text(json.dumps({'findings':'MOCK verified fixture output'}))
        base['stdout']='{"type":"thread.started","thread_id":"mock-runtime-thread"}\n{"type":"turn.completed"}\n'
        return base

    def test_no_grant_blocks_before_any_subprocess_or_auth_access(self):
        adapter = ChatGPTCodex(str(self.fake_cli),str(self.launcher),'fixture-model',self.grant['auth_home'])
        with patch('tools.supervisor_v2.runtime.command') as child:
            with self.assertRaisesRegex(GateError,'owner model grant'): adapter.execute(self.work,self.home,'fixture')
            child.assert_not_called()

    def test_expired_wrong_model_paid_and_unbounded_grants_rejected(self):
        for field, value in [('valid_until',0),('valid_until',time.time()+90000),('model','other'),
                ('auth','api-key'),('max_runs',0),('max_runs',True),('max_runs',11),
                ('timeout_seconds',121),('max_additional_api_spend_usd',1),('allow_credit_purchase',True),
                ('roles',['worker'])]:
            with self.subTest(field=field,value=value):
                original=copy.deepcopy(self.grant); self.grant[field]=value;self.write()
                with self.assertRaises(GateError): self.policy.validate('worker')
                self.grant=original;self.write()

    def test_mock_incomplete_or_stale_isolation_is_not_authority(self):
        for field,value in [('status','NOT_VERIFIED'),('classification','MOCK'),('platform','different-OS'),
                ('reviewer','MOCK-owner'),('valid_until',0),('capabilities',[]),
                ('live_auth_boundary_verified',False),('profile_sha256','x'*64),('launcher_sha256','0'*64)]:
            with self.subTest(field=field):
                original=copy.deepcopy(self.qa);self.qa[field]=value;self.write()
                with self.assertRaises(GateError):self.policy.validate('worker')
                self.qa=original;self.write()

    def test_mutated_launcher_and_unsafe_control_file_block(self):
        self.launcher.write_text('changed binary')
        with self.assertRaisesRegex(GateError,'hash changed'):self.policy.validate('worker')
        self.write(); self.grant_file.chmod(0o644)
        with self.assertRaisesRegex(GateError,'0600'):self.policy.validate('worker')

    def test_symlink_control_files_rejected(self):
        alias=self.control/'alias.json';alias.symlink_to(self.grant_file)
        with self.assertRaisesRegex(GateError,'symlink'):private_json(alias,self.repo)

    def test_authentication_files_are_never_policy_inputs(self):
        path=self.control/'auth.json';path.write_text('SYNTHETIC ONLY');path.chmod(0o600)
        with patch('tools.supervisor_v2.security.os.open') as read:
            with self.assertRaisesRegex(GateError,'authentication material'):
                private_json(path,self.repo)
            read.assert_not_called()
        self.policy.auth_home=self.control
        with patch('tools.supervisor_v2.security.private_json') as read:
            with self.assertRaisesRegex(GateError,'authentication home'):
                self.policy.validate('worker')
            read.assert_not_called()

    def test_concurrent_run_reservation_is_bounded(self):
        self.grant['max_runs']=1;self.write()
        def reserve(_):
            try:self.policy.reserve('worker');return True
            except GateError:return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sum(pool.map(reserve,range(2))),1)

    def test_success_contract_is_mocked_and_records_runtime_session(self):
        with patch.dict(os.environ,{'GH_TOKEN':'synthetic','OPENAI_API_KEY':'synthetic'}), \
                patch('tools.supervisor_v2.runtime.command',side_effect=self.fake_command):
            result=self.adapter.execute(self.work,self.home,'fixture only')
        self.assertEqual(result['model_status'],'COMPLETED')
        self.assertEqual(result['model_session_id'],'mock-runtime-thread')
        self.assertEqual(result['classification'],'LOCAL_RUNTIME_CHATGPT_MODEL')
        self.assertIn('WITHHELD',result['argv'][-1])
        with self.assertRaisesRegex(GateError,'exhausted'):
            self.policy.reserve('supervisor');self.policy.reserve('worker')

    def test_api_key_or_expired_login_never_reaches_model(self):
        for text in ('Logged in using an API key','Not logged in'):
            with self.subTest(text=text):
                self.grant['approval_ref'] += '-new';self.write()
                with patch('tools.supervisor_v2.runtime.command',return_value={'exit_code':0,'stdout':text,'stderr':''}) as child:
                    with self.assertRaisesRegex(GateError,'ChatGPT login'):self.adapter.execute(self.work,self.home,'fixture')
                    self.assertEqual(child.call_count,1)

    def test_nonzero_missing_json_bad_schema_and_model_events_fail_closed(self):
        variants=('exit','missing','json','schema','no-session','duplicate-session','failed-event','incomplete')
        for variant in variants:
            with self.subTest(variant=variant):
                self.grant['approval_ref'] += '-new';self.write()
                def bad(argv,cwd,home,pulse=lambda:None,**kw):
                    r=self.fake_command(argv,cwd,home,pulse,**kw)
                    if argv[-2:]==['login','status']:return r
                    output=Path(argv[argv.index('--output-last-message')+1])
                    if variant=='exit':r['exit_code']=1
                    elif variant=='missing':output.unlink()
                    elif variant=='json':output.write_text('not JSON')
                    elif variant=='schema':output.write_text('{"unexpected":"field"}')
                    elif variant=='no-session':r['stdout']='{"type":"turn.completed"}\n'
                    elif variant=='duplicate-session':r['stdout']+='{"type":"thread.started","thread_id":"second"}\n'
                    elif variant=='failed-event':r['stdout']+='{"type":"turn.failed"}\n'
                    else:r['stdout']='{"type":"thread.started","thread_id":"one"}\n'
                    return r
                with patch('tools.supervisor_v2.runtime.command',side_effect=bad):
                    with self.assertRaises(GateError):self.adapter.execute(self.work,self.home,'fixture')

    def test_cancellation_reserves_attempt_and_propagates_failure(self):
        def cancelled():raise GateError('emergency stop')
        with patch('tools.supervisor_v2.runtime.command',side_effect=self.fake_command):
            with self.assertRaisesRegex(GateError,'emergency'):self.adapter.execute(self.work,self.home,'fixture',cancelled)
        self.policy.reserve('worker')
        with self.assertRaisesRegex(GateError,'exhausted'):self.policy.reserve('supervisor')


class InterfaceTests(unittest.TestCase):
    def test_backend_is_explicit_and_does_not_silently_fallback(self):
        for config in ({},{'backend':'ollama'},{'backend':'agents-api'},{'backend':'codex-python-sdk'}):
            with self.subTest(config=config),self.assertRaises(GateError):load_backend(config)

    def test_strict_model_schema(self):
        schema={'type':'object','additionalProperties':False,'properties':{'findings':{'type':'string'}},'required':['findings']}
        for value in ({},[],{'findings':''},{'findings':4},{'findings':'x','extra':'bad'}):
            with self.subTest(value=value),self.assertRaises(GateError):validate_schema(value,schema)

    def test_jail_profile_denies_default_and_never_allows_network(self):
        with tempfile.TemporaryDirectory() as root:
            a,b=Path(root)/'work',Path(root)/'home';a.mkdir();b.mkdir()
            policy=profile(a,b)
            self.assertIn('(deny default)',policy)
            self.assertNotIn('allow network',policy)
            self.assertNotIn('(allow default)',policy)
            with self.assertRaises(GateError):profile(a,a)

    def test_jail_probe_unavailable_or_failed_never_says_pass(self):
        with patch('tools.supervisor_v2.offline_jail.platform.system',return_value='unsupported'):
            with self.assertRaisesRegex(GateError,'NOT_VERIFIED'):probe()
        # This is a mocked launch failure, not native isolation proof.
        with patch('tools.supervisor_v2.offline_jail.platform.system',return_value='Darwin'), \
             patch('tools.supervisor_v2.offline_jail.Path.is_file',return_value=True), \
             patch('tools.supervisor_v2.runtime.command',return_value={'exit_code':-6,'stderr':''}):
            r=probe();self.assertEqual(r['status'],'BLOCKED');self.assertFalse(r['live_auth_boundary_verified'])


if __name__=='__main__':unittest.main()
