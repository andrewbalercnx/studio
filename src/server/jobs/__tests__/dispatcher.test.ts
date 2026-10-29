import { describe, expect, it, vi } from 'vitest';
import {
  CloudTasksDispatcher,
  InProcessDispatcher,
  createDispatcherFromEnv,
  readCloudTasksConfig,
  type CloudTasksClientLike,
} from '../dispatcher';

const config = {
  project: 'proj',
  location: 'europe-west2',
  runUrl: 'https://app.example/api/internal/jobs/run',
  serviceAccountEmail: 'jobs-invoker@proj.iam.gserviceaccount.com',
  audience: 'https://app.example/api/internal/jobs/run',
  queuePrefix: 'storypic-',
};

function fakeClient(createTask: CloudTasksClientLike['createTask'] = vi.fn().mockResolvedValue([{}])) {
  return {
    queuePath: (project: string, location: string, queue: string) => `projects/${project}/locations/${location}/queues/${queue}`,
    createTask,
  };
}

describe('CloudTasksDispatcher', () => {
  it('creates one OIDC-authenticated HTTP task per job attempt on the kind group queue', async () => {
    const client = fakeClient();
    const dispatcher = new CloudTasksDispatcher(config, client, () => 1_000_000);
    await dispatcher.dispatch({ jobId: 'job_abc', kind: 'book.pageArt', attempt: 2, queue: 'ai-image', delayMs: 30_000 });

    const parent = 'projects/proj/locations/europe-west2/queues/storypic-ai-image';
    expect(client.createTask).toHaveBeenCalledWith({
      parent,
      task: {
        name: `${parent}/tasks/job_abc-2`,
        httpRequest: {
          httpMethod: 'POST',
          url: config.runUrl,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(JSON.stringify({ jobId: 'job_abc' })).toString('base64'),
          oidcToken: { serviceAccountEmail: config.serviceAccountEmail, audience: config.audience },
        },
        scheduleTime: { seconds: 1_030 },
      },
    });
  });

  it('treats an existing task (same job attempt) as already dispatched', async () => {
    const dispatcher = new CloudTasksDispatcher(config, fakeClient(vi.fn().mockRejectedValue(Object.assign(new Error('exists'), { code: 6 }))));
    await expect(dispatcher.dispatch({ jobId: 'j', kind: 'k', attempt: 0, queue: 'tts' })).resolves.toBeUndefined();
  });

  it('propagates other errors', async () => {
    const dispatcher = new CloudTasksDispatcher(config, fakeClient(vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { code: 7 }))));
    await expect(dispatcher.dispatch({ jobId: 'j', kind: 'k', attempt: 0, queue: 'tts' })).rejects.toThrow('denied');
  });
});

describe('readCloudTasksConfig / createDispatcherFromEnv', () => {
  it('reads env with defaults', () => {
    expect(
      readCloudTasksConfig({
        GOOGLE_CLOUD_PROJECT: 'p',
        JOBS_RUN_URL: 'https://x/run',
        JOBS_INVOKER_SERVICE_ACCOUNT: 'sa@p.iam.gserviceaccount.com',
      })
    ).toEqual({
      project: 'p',
      location: 'us-central1',
      runUrl: 'https://x/run',
      serviceAccountEmail: 'sa@p.iam.gserviceaccount.com',
      audience: 'https://x/run',
      queuePrefix: '',
    });
  });

  it('names every missing setting', () => {
    expect(() => readCloudTasksConfig({})).toThrow(
      /JOBS_TASKS_PROJECT, JOBS_RUN_URL, JOBS_INVOKER_SERVICE_ACCOUNT/
    );
  });

  it('defaults to the in-process dispatcher', () => {
    expect(createDispatcherFromEnv({})).toBeInstanceOf(InProcessDispatcher);
  });
});

describe('InProcessDispatcher', () => {
  it('runs dispatched jobs asynchronously and drains them', async () => {
    const dispatcher = new InProcessDispatcher({ sleep: async () => undefined });
    const ran: string[] = [];
    dispatcher.attach(async (jobId) => {
      ran.push(jobId);
    });
    await dispatcher.dispatch({ jobId: 'a', kind: 'k', attempt: 0, queue: 'render' });
    expect(ran).toEqual([]);
    await dispatcher.drain();
    expect(ran).toEqual(['a']);
  });

  it('refuses to dispatch before a runner is attached', async () => {
    await expect(new InProcessDispatcher().dispatch({ jobId: 'a', kind: 'k', attempt: 0, queue: 'render' })).rejects.toThrow(
      /not attached/
    );
  });
});
