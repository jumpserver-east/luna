import { createDeviceMonitor } from '@app/utils/deviceMonitor';

const DEVICE_URL = 'https://127.0.0.1:51245/alpha';
const FORM_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded' };
const LOAD_LIBRARY_BODY = `json=${JSON.stringify({
  function: 'SOF_LoadLibrary',
  winDllName: 'mtoken_gm3000.dll',
  linuxSOName: 'libgm3000.1.0.so',
  macDylibName: 'libgm3000.1.0.dylib'
})}`;
const REQUEST_BODY = `json=${JSON.stringify({ function: 'SOF_EnumDevice' })}`;

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

// 按请求体区分 SOF_LoadLibrary / SOF_EnumDevice 两步探测，返回各自的响应数据。
function makeRequest(load: any, enumerate: any) {
  return {
    post: jasmine.createSpy('post').and.callFake((_url: string, body: string) => {
      if (body === LOAD_LIBRARY_BODY) {
        return Promise.resolve({ data: load });
      }
      return Promise.resolve({ data: enumerate });
    })
  };
}

describe('Utils:deviceMonitor', () => {
  it('loads the library then enumerates the device on start and on each interval tick', async () => {
    const request = makeRequest({ errorCode: 0 }, { errorCode: 0 });
    const { setTimer, clearTimer, tick } = createManualTimer();
    const monitor = createDeviceMonitor({ request, setTimer, clearTimer });

    monitor.start();
    await flushPromises();

    expect(request.post).toHaveBeenCalledTimes(2);
    expect(request.post.calls.argsFor(0)).toEqual([
      DEVICE_URL,
      LOAD_LIBRARY_BODY,
      { headers: FORM_HEADERS, timeout: 1500 }
    ]);
    expect(request.post.calls.argsFor(1)).toEqual([
      DEVICE_URL,
      REQUEST_BODY,
      { headers: FORM_HEADERS, timeout: 1500 }
    ]);

    tick();
    await flushPromises();
    expect(request.post).toHaveBeenCalledTimes(4);
  });

  it('stops and triggers the handler once when enumeration returns a non-zero errorCode', async () => {
    const request = makeRequest({ errorCode: 0 }, { errorCode: 1 });
    const onDeviceError = jasmine.createSpy('onDeviceError');
    const { setTimer, clearTimer, tick } = createManualTimer();
    const monitor = createDeviceMonitor({ request, onDeviceError, setTimer, clearTimer });

    monitor.start();
    await flushPromises();
    tick();
    await flushPromises();

    expect(onDeviceError).toHaveBeenCalledTimes(1);
    expect(request.post).toHaveBeenCalledTimes(2);
  });

  it('stops on a load-library error and never enumerates the device', async () => {
    const request = makeRequest({ errorCode: 1 }, { errorCode: 0 });
    const onDeviceError = jasmine.createSpy('onDeviceError');
    const { setTimer, clearTimer } = createManualTimer();
    const monitor = createDeviceMonitor({ request, onDeviceError, setTimer, clearTimer });

    monitor.start();
    await flushPromises();

    expect(onDeviceError).toHaveBeenCalledTimes(1);
    expect(request.post).toHaveBeenCalledTimes(1);
  });

  it('does not trigger the handler for successful, missing, or invalid error codes', async () => {
    const request = {
      post: jasmine.createSpy('post').and.callFake((_url: string, body: string) => {
        if (body === LOAD_LIBRARY_BODY) {
          return Promise.resolve({ data: { errorCode: 0 } });
        }
        return Promise.resolve({ data: { errorCode: 'invalid' } });
      })
    };
    const onDeviceError = jasmine.createSpy('onDeviceError');
    const { setTimer, clearTimer, tick } = createManualTimer();
    const monitor = createDeviceMonitor({ request, onDeviceError, setTimer, clearTimer });

    monitor.start();
    await flushPromises();
    tick();
    await flushPromises();

    expect(onDeviceError).not.toHaveBeenCalled();
  });

  it('skips enumeration and keeps polling after a load-library request failure', async () => {
    let loadCall = 0;
    const request = {
      post: jasmine.createSpy('post').and.callFake((_url: string, body: string) => {
        if (body === LOAD_LIBRARY_BODY) {
          loadCall += 1;
          if (loadCall === 1) {
            return Promise.reject(new Error('unavailable'));
          }
          return Promise.resolve({ data: { errorCode: 0 } });
        }
        return Promise.resolve({ data: { errorCode: 0 } });
      })
    };
    const onDeviceError = jasmine.createSpy('onDeviceError');
    const { setTimer, clearTimer, tick } = createManualTimer();
    const monitor = createDeviceMonitor({ request, onDeviceError, setTimer, clearTimer });

    monitor.start();
    await flushPromises();
    expect(request.post).toHaveBeenCalledTimes(1);
    expect(onDeviceError).not.toHaveBeenCalled();

    tick();
    await flushPromises();
    expect(request.post).toHaveBeenCalledTimes(3);
    expect(onDeviceError).not.toHaveBeenCalled();
  });

  it('triggers the handler when an HTTP error response contains a non-zero errorCode', async () => {
    const request = {
      post: jasmine
        .createSpy('post')
        .and.rejectWith({ response: { data: { errorCode: -1 } } })
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
