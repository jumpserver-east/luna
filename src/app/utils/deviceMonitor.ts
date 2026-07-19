const DEVICE_URL = 'https://127.0.0.1:51245/alpha';
const POLL_INTERVAL = 2 * 1000;
const REQUEST_TIMEOUT = 1500;
const FORM_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded'
};
const LOAD_LIBRARY_BODY = `json=${JSON.stringify({
  function: 'SOF_LoadLibrary',
  winDllName: 'mtoken_gm3000.dll',
  linuxSOName: 'libgm3000.1.0.so',
  macDylibName: 'libgm3000.1.0.dylib'
})}`;
const REQUEST_BODY = `json=${JSON.stringify({ function: 'SOF_EnumDevice' })}`;

interface DeviceResponse {
  data?: any;
}

interface DeviceRequest {
  post(url: string, body: any, options?: any): Promise<DeviceResponse>;
}

interface CreateDeviceMonitorOptions {
  request?: DeviceRequest;
  onDeviceError?: () => void;
  setTimer?: (handler: () => void, interval: number) => any;
  clearTimer?: (handle: any) => void;
}

// UKey 被拔出等设备异常时，强制退出并回到主站。
// 先打上强制离开标记，让页面的 beforeunload 处理器跳过“离开确认”弹窗；
// 再跳转顶层窗口，确保 luna 嵌在主站 iframe 内时也能整体退出（而非只刷新 iframe）。
function redirectToHome(): void {
  window.__DEVICE_FORCE_LEAVE__ = true;
  try {
    (window.top || window).location.href = '/';
  } catch {
    window.location.href = '/';
  }
}

// 默认请求实现：用原生 fetch 请求本地设备服务，并对齐 { data } 的返回形态，附带超时控制。
const defaultRequest: DeviceRequest = {
  async post(url: string, body: any, options: any = {}): Promise<DeviceResponse> {
    const controller = new AbortController();
    const timeout = options.timeout || REQUEST_TIMEOUT;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        body,
        headers: options.headers,
        signal: controller.signal
      });

      const text = await response.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        data = undefined;
      }
      return { data };
    } finally {
      clearTimeout(timer);
    }
  }
};

export function createDeviceMonitor({
  request = defaultRequest,
  onDeviceError = redirectToHome,
  setTimer = setInterval,
  clearTimer = clearInterval
}: CreateDeviceMonitorOptions = {}) {
  let timer: any = null;
  let requestInFlight = false;
  let running = false;
  let runId = 0;

  function hasDeviceError(data: any): boolean {
    if (!data || !Object.prototype.hasOwnProperty.call(data, 'errorCode')) {
      return false;
    }

    const errorCode = Number(data.errorCode);
    return !isNaN(errorCode) && errorCode !== 0;
  }

  function stop(): void {
    running = false;
    runId += 1;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  }

  async function postForm(url: string, body: any): Promise<any> {
    try {
      const response = await request.post(url, body, {
        headers: FORM_HEADERS,
        timeout: REQUEST_TIMEOUT
      });
      return response.data;
    } catch (error) {
      return (error as any)?.response?.data;
    }
  }

  function handleDeviceError(data: any, currentRunId: number): boolean {
    if (!running || currentRunId !== runId || !hasDeviceError(data)) {
      return false;
    }

    stop();
    onDeviceError();
    return true;
  }

  async function poll(): Promise<void> {
    if (!running || requestInFlight) {
      return;
    }

    const currentRunId = runId;
    requestInFlight = true;
    try {
      const loadLibraryData = await postForm(DEVICE_URL, LOAD_LIBRARY_BODY);
      if (handleDeviceError(loadLibraryData, currentRunId)) {
        return;
      }

      if (!running || currentRunId !== runId || !loadLibraryData) {
        return;
      }

      const responseData = await postForm(DEVICE_URL, REQUEST_BODY);
      handleDeviceError(responseData, currentRunId);
    } finally {
      requestInFlight = false;
    }
  }

  function start(): void {
    if (running) {
      return;
    }

    running = true;
    runId += 1;
    timer = setTimer(poll, POLL_INTERVAL);
    poll();
  }

  return { start, stop, poll };
}

const deviceMonitor = createDeviceMonitor();

export default deviceMonitor;
