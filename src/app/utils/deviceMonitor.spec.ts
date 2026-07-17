import { createDeviceMonitor } from '@app/utils/deviceMonitor';

const DEVICE_URL = 'https://127.0.0.1:51245/alpha';
const REQUEST_BODY = 'json=%7B%22function%22%3A%22SOF_EnumDevice%22%7D';

function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function createManualTimer() {
  let scheduled: (() => void) | null = null;
  const setTimer = jasmine.createSpy('setTimer').and.callFake((handler: () => void) => {
    scheduled = handler;
    return 1;
  });
  const clearTimer = jasmine.createSpy('clearTimer').and.callFake(() => {
    scheduled = null;
  });
  return {
    setTimer,
    clearTimer,
    tick: () => {
      if (scheduled) {
        scheduled();
      }
    }
  };
}

describe('Utils:deviceMonitor', () => {
  it('posts the device enumeration form on start and on each interval tick', async () => {
    const request = { post: jasmine.createSpy('post').and.resolveTo({ data: { errorCode: 0 } }) };
    const { setTimer, clearTimer, tick } = createManualTimer();
    const monitor = createDeviceMonitor({ request, setTimer, clearTimer });

    monitor.start();
    await flushPromises();

    expect(request.post).toHaveBeenCalledWith(DEVICE_URL, REQUEST_BODY, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 1500
    });
    expect(request.post).toHaveBeenCalledTimes(1);

    tick();
    await flushPromises();
    expect(request.post).toHaveBeenCalledTimes(2);
  });

  it('stops polling and logs out once for a non-zero errorCode', async () => {
    const request = { post: jasmine.createSpy('post').and.resolveTo({ data: { errorCode: 1 } }) };
    const onDeviceError = jasmine.createSpy('onDeviceError');
    const { setTimer, clearTimer, tick } = createManualTimer();
    const monitor = createDeviceMonitor({ request, onDeviceError, setTimer, clearTimer });

    monitor.start();
    await flushPromises();
    tick();
    await flushPromises();

    expect(onDeviceError).toHaveBeenCalledTimes(1);
    expect(request.post).toHaveBeenCalledTimes(1);
  });

  it('does not log out for successful, missing, or invalid error codes', async () => {
    const request = {
      post: jasmine.createSpy('post').and.returnValues(
        Promise.resolve({ data: { errorCode: 0 } }),
        Promise.resolve({ data: {} }),
        Promise.resolve({ data: { errorCode: 'invalid' } })
      )
    };
    const onDeviceError = jasmine.createSpy('onDeviceError');
    const { setTimer, clearTimer, tick } = createManualTimer();
    const monitor = createDeviceMonitor({ request, onDeviceError, setTimer, clearTimer });

    monitor.start();
    await flushPromises();
    tick();
    await flushPromises();
    tick();
    await flushPromises();

    expect(onDeviceError).not.toHaveBeenCalled();
  });

  it('continues polling after a request failure', async () => {
    const request = {
      post: jasmine.createSpy('post').and.returnValues(
        Promise.reject(new Error('unavailable')),
        Promise.resolve({ data: { errorCode: 0 } })
      )
    };
    const onDeviceError = jasmine.createSpy('onDeviceError');
    const { setTimer, clearTimer, tick } = createManualTimer();
    const monitor = createDeviceMonitor({ request, onDeviceError, setTimer, clearTimer });

    monitor.start();
    await flushPromises();
    tick();
    await flushPromises();

    expect(request.post).toHaveBeenCalledTimes(2);
    expect(onDeviceError).not.toHaveBeenCalled();
  });

  it('logs out when an HTTP error response contains a non-zero errorCode', async () => {
    const request = {
      post: jasmine.createSpy('post').and.rejectWith({ response: { data: { errorCode: -1 } } })
    };
    const onDeviceError = jasmine.createSpy('onDeviceError');
    const { setTimer, clearTimer } = createManualTimer();
    const monitor = createDeviceMonitor({ request, onDeviceError, setTimer, clearTimer });

    monitor.start();
    await flushPromises();

    expect(onDeviceError).toHaveBeenCalledTimes(1);
  });

  it('does not overlap requests or act on a response after stop', async () => {
    let resolveRequest!: (value: any) => void;
    const request = {
      post: jasmine.createSpy('post').and.callFake(
        () =>
          new Promise(resolve => {
            resolveRequest = resolve;
          })
      )
    };
    const onDeviceError = jasmine.createSpy('onDeviceError');
    const { setTimer, clearTimer, tick } = createManualTimer();
    const monitor = createDeviceMonitor({ request, onDeviceError, setTimer, clearTimer });

    monitor.start();
    tick();
    expect(request.post).toHaveBeenCalledTimes(1);

    monitor.stop();
    resolveRequest({ data: { errorCode: 1 } });
    await flushPromises();
    expect(onDeviceError).not.toHaveBeenCalled();
  });
});
