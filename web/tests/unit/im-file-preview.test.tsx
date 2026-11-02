// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FilePreview } from "@/components/im/FilePreview";

vi.mock("next-intl", () => {
  const cache = new Map<string, (key: string, vars?: Record<string, unknown>) => string>();
  const useTranslations = (ns: string) => {
    let fn = cache.get(ns);
    if (!fn) {
      const created = (key: string, vars?: Record<string, unknown>) =>
        vars ? `${ns}:${key}:${JSON.stringify(vars)}` : `${ns}:${key}`;
      cache.set(ns, created);
      fn = created;
    }
    return fn;
  };
  return { useTranslations };
});

interface Att {
  id: string;
  fileName: string;
  url: string;
  fileType: string;
  fileSize: number;
  thumbnailUrl: string | null;
}

const fileAtt: Att = {
  id: "a1",
  fileName: "doc.pdf",
  url: "/files/doc.pdf",
  fileType: "application/pdf",
  fileSize: 2048,
  thumbnailUrl: null,
};

afterEach(() => {
  cleanup();
});

describe("FilePreview", () => {
  it("renders a download anchor for non-image files", () => {
    const { container } = render(<FilePreview attachment={fileAtt} />);
    const link = screen.getByRole("link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/files/doc.pdf");
    expect(link.getAttribute("download")).toBe("doc.pdf");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("doc.pdf")).toBeTruthy();
    expect(screen.getByText("2.0 KB")).toBeTruthy();
    // non-image branch always uses FileText (the ImageIcon branch is unreachable here)
    expect(container.querySelector("svg.lucide-file-text")).not.toBeNull();
    expect(container.querySelector("svg.lucide-image")).toBeNull();
    expect(container.querySelector("svg.lucide-download")).not.toBeNull();
  });

  it("formats file sizes across the B/KB/MB/GB boundaries", () => {
    const cases: Array<[number, string]> = [
      [-5, "0 B"],
      [0, "0 B"],
      [512, "512 B"],
      [1023, "1023 B"],
      [1024, "1.0 KB"],
      [1048576, "1.0 MB"],
      [1073741824, "1.0 GB"],
    ];
    for (const [size, expected] of cases) {
      const { unmount } = render(<FilePreview attachment={{ ...fileAtt, fileSize: size }} />);
      expect(screen.getByText(expected)).toBeTruthy();
      unmount();
    }
  });

  it("calls the external onClick for non-image clicks", () => {
    const onClick = vi.fn();
    render(<FilePreview attachment={fileAtt} onClick={onClick} />);
    fireEvent.click(screen.getByRole("link"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the thumbnail (or the full url) for image attachments", () => {
    const imgAtt: Att = {
      id: "a2",
      fileName: "pic.png",
      url: "/files/pic.png",
      fileType: "image/png",
      fileSize: 10240,
      thumbnailUrl: "/files/pic.thumb.png",
    };
    render(<FilePreview attachment={imgAtt} />);
    const button = screen.getByRole("button", { name: "pic.png" });
    expect(button).toBeTruthy();
    let img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("/files/pic.thumb.png");
    expect(img!.getAttribute("alt")).toBe("pic.png");
    // non-image UI must not render
    expect(screen.queryByRole("link")).toBeNull();

    cleanup();
    render(<FilePreview attachment={{ ...imgAtt, thumbnailUrl: null }} />);
    img = document.querySelector("img");
    expect(img!.getAttribute("src")).toBe("/files/pic.png");
  });

  it("toggles the expanded preview modal when no external onClick is given", () => {
    const imgAtt: Att = {
      id: "a3",
      fileName: "pic.png",
      url: "/files/pic.png",
      fileType: "image/png",
      fileSize: 10240,
      thumbnailUrl: null,
    };
    render(<FilePreview attachment={imgAtt} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "pic.png" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-label", "chat:imagePreview");
    const fullImg = dialog.querySelector("img");
    expect(fullImg!.getAttribute("src")).toBe("/files/pic.png");

    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("delegates to the external onClick instead of expanding", () => {
    const onClick = vi.fn();
    const imgAtt: Att = {
      id: "a4",
      fileName: "pic.png",
      url: "/files/pic.png",
      fileType: "image/png",
      fileSize: 10240,
      thumbnailUrl: null,
    };
    render(<FilePreview attachment={imgAtt} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "pic.png" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
