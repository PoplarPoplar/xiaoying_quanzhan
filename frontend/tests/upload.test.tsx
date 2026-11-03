import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  cleanup,
} from "@testing-library/react";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../src/lib/api", async () => ({
  ...(await vi.importActual("../src/lib/api")),
  api: mocks.api,
}));
import { Upload } from "../src/components/workspace";
const template = {
  id: "t",
  categoryId: "a",
  title: "test",
  description: "",
  coverUrl: "",
  requiredImageCount: 1,
  acceptedMimeTypes: ["image/png"],
  maxFileSizeBytes: 5,
};
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe("上传槽位", () => {
  it("非法类型和过大文件不发送请求", () => {
    const onChange = vi.fn();
    render(<Upload index={0} template={template} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("选择素材1"), {
      target: { files: [new File(["x"], "x.txt", { type: "text/plain" })] },
    });
    expect(screen.getByRole("alert").textContent).toContain("JPEG");
    fireEvent.change(screen.getByLabelText("选择素材1"), {
      target: {
        files: [new File(["123456"], "large.png", { type: "image/png" })],
      },
    });
    expect(screen.getByRole("alert").textContent).toContain("大小");
    expect(mocks.api).not.toHaveBeenCalled();
  });
  it("替换中的旧响应不能覆盖新素材，移除清理预览", async () => {
    const resolvers: ((value: { id: string }) => void)[] = [];
    mocks.api.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve)),
    );
    const onChange = vi.fn();
    render(<Upload index={0} template={template} onChange={onChange} />);
    const input = screen.getByLabelText("选择素材1");
    fireEvent.change(input, {
      target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
    });
    fireEvent.change(input, {
      target: { files: [new File(["b"], "b.png", { type: "image/png" })] },
    });
    await act(async () => {
      resolvers[1]({ id: "new" });
      await Promise.resolve();
      resolvers[0]({ id: "old" });
      await Promise.resolve();
    });
    expect(onChange.mock.calls.at(-1)?.[0].id).toBe("new");
    fireEvent.click(screen.getByText("移除素材1"));
    expect(onChange.mock.calls.at(-1)?.[0].status).toBe("EMPTY");
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
  it("卸载后忽略上传响应并撤销本地预览", async () => {
    let resolve!: (value: { id: string }) => void;
    mocks.api.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const onChange = vi.fn();
    const rendered = render(
      <Upload index={0} template={template} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("选择素材1"), {
      target: { files: [new File(["a"], "a.png", { type: "image/png" })] },
    });
    rendered.unmount();
    await act(async () => {
      resolve({ id: "late" });
      await Promise.resolve();
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });
});
