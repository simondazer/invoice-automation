#!/usr/bin/env python3
"""Fetch invoice mails from Lark/Feishu Mail and render PDF invoices to images.

Default output:
  ~/Documents/Reimbursement Receipts/<YYYY-MM-DD>/processed_invoices.json
  ~/Documents/Reimbursement Receipts/<YYYY-MM-DD>/<HH-MM-SS>/<City>/*.png
  ~/Documents/Reimbursement Receipts/<YYYY-MM-DD>/<HH-MM-SS>/_backup/<City>/*.{pdf,ofd,xml}
  ~/Documents/Reimbursement Receipts/<YYYY-MM-DD>/<HH-MM-SS>/manifest.json

Requirements:
  - lark-cli is installed and logged in with mail read permissions
  - macOS qlmanage is available for PDF -> PNG rendering
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from datetime import date, datetime, time, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable


INVOICE_KEYWORDS = ("发票", "电子发票", "invoice", "Invoice")
BACKUP_INVOICE_SUFFIXES = (".pdf", ".ofd", ".xml")
IMAGE_INVOICE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")
SUPPORTED_INVOICE_SUFFIXES = BACKUP_INVOICE_SUFFIXES + IMAGE_INVOICE_SUFFIXES
DEFAULT_OUTPUT_ROOT = Path.home() / "github-projects" / "schema-resource-mapping" / "invoice-outputs"
DEFAULT_IMAGE_SIZE = 2480


@dataclass
class DownloadedFile:
    source: str
    message_id: str
    subject: str
    url: str
    path: str
    bytes: int
    content_type: str
    reused: bool = False


@dataclass
class ConversionResult:
    pdf: str
    image: str
    reused: bool = False


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href and href.startswith("http"):
            self.links.append(href)


def run_command(args: list[str], *, timeout: int = 120) -> str:
    proc = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command failed ({proc.returncode}): {' '.join(args)}\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
        )
    return proc.stdout


def run_lark(args: list[str], *, timeout: int = 180) -> dict[str, Any]:
    raw = run_command(args, timeout=timeout)
    start = raw.find("{")
    if start < 0:
        raise RuntimeError(f"lark-cli did not return JSON. Output was:\n{raw[:500]}")
    return json.loads(raw[start:])


def sanitize_filename(name: str) -> str:
    name = urllib.parse.unquote(name)
    name = re.sub(r"[\\/:*?\"<>|\n\r\t]+", "_", name).strip(" ._")
    return name[:180] or "invoice"


KNOWN_CITIES = (
    "北京", "上海", "天津", "重庆", "深圳", "广州", "东莞", "佛山", "珠海", "中山", "惠州",
    "杭州", "宁波", "南京", "苏州", "无锡", "成都", "武汉", "长沙", "西安", "厦门", "福州",
    "泉州", "南宁", "海口", "三亚", "青岛", "济南", "郑州", "合肥", "昆明", "贵阳",
)


def detect_city(*parts: str) -> str:
    text = re.sub(r"\s+", "", " ".join(part or "" for part in parts))
    for city in sorted(KNOWN_CITIES, key=len, reverse=True):
        if city in text or f"{city}市" in text:
            return city
    match = re.search(r"([一-龥]{2,8})市", text)
    if match:
        return match.group(1)
    return "未知城市"


def local_date_range(day: date) -> tuple[str, str]:
    # datetime.astimezone() uses the machine's local timezone.
    tz = datetime.now().astimezone().tzinfo
    start = datetime.combine(day, time.min, tzinfo=tz)
    end = start + timedelta(days=1)
    return start.isoformat(), end.isoformat()


def unique_keep_suffix(path: Path) -> Path:
    if not path.exists():
        return path
    for idx in range(2, 1000):
        candidate = path.with_name(f"{path.stem}_{idx}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise RuntimeError(f"Cannot create a unique path for {path}")


def run_id_for_now() -> str:
    return datetime.now().strftime("%H-%M-%S")


def invoice_key(*parts: str) -> str:
    raw = "|".join(part.strip() for part in parts if part)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def load_processed_invoices(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "records": {}}
    return json.loads(path.read_text(encoding="utf-8"))


def save_processed_invoices(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    data["updated_at"] = datetime.now().isoformat()
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def is_processed(processed: dict[str, Any], key: str) -> bool:
    return key in processed.setdefault("records", {})


def mark_processed(processed: dict[str, Any], key: str, record: dict[str, Any]) -> None:
    records = processed.setdefault("records", {})
    records[key] = {"processed_at": datetime.now().isoformat(), **record}


def seed_processed_from_legacy_outputs(day_dir: Path, processed: dict[str, Any]) -> int:
    """Import records from older flat-output manifests so day-level dedupe includes previous runs."""
    seeded = 0
    manifest_paths = [day_dir / "download_manifest.json", day_dir / "manifest.json"]
    manifest_paths.extend(sorted((day_dir / "runs").glob("*/manifest.json")))
    manifest_paths.extend(sorted(day_dir.glob("[0-9][0-9]-[0-9][0-9]-[0-9][0-9]/manifest.json")))
    for manifest_path in manifest_paths:
        if not manifest_path.exists():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except Exception:
            continue

        legacy_items = manifest.get("invoice_files_downloaded") or manifest.get("downloads") or []
        for item in legacy_items:
            path_value = item.get("path") or ""
            if not str(path_value).lower().endswith(SUPPORTED_INVOICE_SUFFIXES):
                continue
            source = item.get("source") or "body_link"
            message_id = item.get("message_id") or ""
            subject = item.get("subject") or item.get("source_subject") or ""
            url = item.get("url") or ""
            name = Path(path_value).name
            if source == "body_link":
                key = invoice_key("body_link", name, url)
            elif source == "mail_attachment":
                key = invoice_key("mail_attachment", message_id, name)
            else:
                key = invoice_key(source, message_id, name, url)
            if is_processed(processed, key):
                continue
            mark_processed(processed, key, {"source": source, "message_id": message_id, "subject": subject, "url": url, "path": path_value, "seeded_from": str(manifest_path)})
            seeded += 1
    return seeded


def request_for(url: str, *, referer: str | None = None) -> urllib.request.Request:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "*/*",
    }
    if referer:
        headers["Referer"] = referer
    return urllib.request.Request(url, headers=headers)


def download_url(
    url: str,
    output_dir: Path,
    filename: str,
    *,
    source: str,
    message_id: str,
    subject: str,
    overwrite: bool,
    city: str = "未知城市",
) -> DownloadedFile:
    output_dir = output_dir / sanitize_filename(city)
    output_dir.mkdir(parents=True, exist_ok=True)
    target = output_dir / sanitize_filename(filename)
    if not overwrite:
        target = unique_keep_suffix(target)
    elif target.exists():
        target.unlink()

    req = request_for(url)
    with urllib.request.urlopen(req, timeout=120) as response:
        data = response.read()
        content_type = response.headers.get("content-type", "")
    target.write_bytes(data)
    return DownloadedFile(source, message_id, subject, url, str(target), len(data), content_type)


def extract_links(message: dict[str, Any]) -> list[str]:
    links: list[str] = []

    parser = LinkParser()
    parser.feed(message.get("body_html") or "")
    links.extend(parser.links)

    body_plain = message.get("body_plain_text") or ""
    links.extend(re.findall(r"https?://[^\s<>\"']+", body_plain))

    seen: set[str] = set()
    unique: list[str] = []
    for link in links:
        link = link.rstrip("，。),]")
        if link not in seen:
            seen.add(link)
            unique.append(link)
    return unique


def looks_like_invoice(message: dict[str, Any]) -> bool:
    subject = message.get("subject") or ""
    body = (message.get("body_plain_text") or "")[:2000]
    head_from = message.get("head_from") or {}
    sender = ""
    if isinstance(head_from, dict):
        sender = head_from.get("mail_address") or ""
    elif isinstance(head_from, str):
        sender = head_from
    haystack = f"{subject}\n{body}\n{sender}"
    return any(keyword in haystack for keyword in INVOICE_KEYWORDS) or "reimburse@bill.larkoffice.com" in sender


def fetch_messages(day: date, max_messages: int) -> list[dict[str, Any]]:
    start, end = local_date_range(day)
    triage = run_lark(
        [
            "lark-cli",
            "mail",
            "+triage",
            "--format",
            "json",
            "--max",
            str(max_messages),
            "--filter",
            json.dumps({"time_range": {"start_time": start, "end_time": end}}, ensure_ascii=False),
        ]
    )
    message_ids = [m["message_id"] for m in triage.get("messages", [])]
    if not message_ids:
        return []

    details = run_lark(
        [
            "lark-cli",
            "mail",
            "+messages",
            "--message-ids",
            ",".join(message_ids),
            "--format",
            "json",
            "--html=true",
        ],
        timeout=300,
    )
    data = details.get("data", {})
    messages = data.get("messages") if isinstance(data, dict) else data
    if isinstance(messages, dict):
        return [messages]
    return list(messages or [])


def get_mail_attachment_download_urls(message_id: str, attachment_ids: list[str]) -> dict[str, str]:
    if not attachment_ids:
        return {}
    result = run_lark(
        [
            "lark-cli",
            "mail",
            "user_mailbox.message.attachments",
            "download_url",
            "--params",
            json.dumps(
                {
                    "user_mailbox_id": "me",
                    "message_id": message_id,
                    "attachment_ids": attachment_ids,
                },
                ensure_ascii=False,
            ),
            "--format",
            "json",
        ]
    )
    payload = result.get("data", result)
    return {item.get("attachment_id"): item.get("download_url") for item in payload.get("download_urls", [])}


def filename_from_url(url: str, default_name: str) -> str:
    parsed = urllib.parse.urlparse(url)
    name = Path(urllib.parse.unquote(parsed.path)).name
    return name or default_name


def crawl_nuonuo_invoice_urls(short_url: str) -> list[tuple[str, str]]:
    """Resolve a Nuonuo short invoice link to downloadable invoice files.

    The public landing page redirects to /scan-invoice/printQrcode?... . Its web app calls
    /scan2/getIvcDetailShow.do and returns invoiceSimpleVo fields that may include PDF/OFD/XML URLs.
    """
    with urllib.request.urlopen(request_for(short_url), timeout=60) as response:
        landing_url = response.geturl()

    parsed = urllib.parse.urlparse(landing_url)
    query = urllib.parse.parse_qs(parsed.query)
    param_list = (query.get("paramList") or [""])[0]
    if not param_list:
        return []

    form = urllib.parse.urlencode(
        {
            "paramList": param_list,
            "code": (query.get("code") or [""])[0],
            "aliView": (query.get("aliView") or ["true"])[0],
            "invoiceDetailMiddleUri": "",
            "shortLinkSource": (query.get("shortLinkSource") or ["1"])[0],
        }
    ).encode()
    req = urllib.request.Request(
        "https://nnfp.jss.com.cn/scan2/getIvcDetailShow.do",
        data=form,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Referer": landing_url,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/plain, */*",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        obj = json.loads(response.read().decode("utf-8"))

    if obj.get("status") != "0000":
        raise RuntimeError(f"Nuonuo invoice API failed for {short_url}: {obj}")

    invoice = obj.get("data", {}).get("invoiceSimpleVo", {})
    invoice_date = (invoice.get("invoiceDate") or "").split()[0] or "invoice"
    seller = invoice.get("saleName") or "nuonuo"
    number = invoice.get("fphm") or invoice.get("id") or "invoice"

    collected: list[tuple[str, str]] = []
    for value in invoice.values():
        if not isinstance(value, str) or not value.startswith("http"):
            continue
        suffix = Path(urllib.parse.urlparse(value).path).suffix.lower()
        if suffix in SUPPORTED_INVOICE_SUFFIXES:
            collected.append((value, f"{invoice_date}_{seller}_{number}{suffix}"))

    pdf_url = invoice.get("url")
    if pdf_url and pdf_url.lower().endswith(".pdf"):
        parsed = urllib.parse.urlparse(pdf_url)
        base_path = parsed.path[:-4]
        for suffix in (".pdf", ".ofd"):
            rebuilt = parsed._replace(path=f"{base_path}{suffix}").geturl()
            collected.append((rebuilt, f"{invoice_date}_{seller}_{number}{suffix}"))

    return dedupe_pairs(collected)


def collect_invoice_links_from_message(message: dict[str, Any]) -> list[tuple[str, str]]:
    collected: list[tuple[str, str]] = []
    for link in extract_links(message):
        parsed = urllib.parse.urlparse(link)
        path_lower = parsed.path.lower()
        if any(path_lower.endswith(suffix) for suffix in SUPPORTED_INVOICE_SUFFIXES):
            collected.append((link, filename_from_url(link, "invoice")))
        elif "nnfp.jss.com.cn" in parsed.netloc:
            collected.extend(crawl_nuonuo_invoice_urls(link))
    return dedupe_pairs(collected)


def dedupe_pairs(pairs: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
    seen: set[str] = set()
    result: list[tuple[str, str]] = []
    for url, name in pairs:
        if url in seen:
            continue
        seen.add(url)
        result.append((url, name))
    return result


def download_invoice_files(
    messages: list[dict[str, Any]],
    backup_dir: Path,
    image_dir: Path,
    *,
    overwrite: bool,
    processed: dict[str, Any],
    processed_path: Path,
) -> tuple[list[DownloadedFile], list[dict[str, str]], list[dict[str, str]], list[dict[str, Any]]]:
    downloaded: list[DownloadedFile] = []
    failures: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    unsupported_messages: list[dict[str, Any]] = []

    for message in messages:
        if not looks_like_invoice(message):
            continue

        message_id = message.get("message_id") or ""
        subject = message.get("subject") or ""
        message_supported_count = 0
        unsupported_attachment_names: list[str] = []
        link_error = ""

        # Real mail attachments. Save supported invoice files into the Backup directory.
        attachments = message.get("attachments") or []
        attachment_ids = [a.get("attachment_id") or a.get("id") for a in attachments]
        attachment_ids = [x for x in attachment_ids if x]
        attachment_urls = get_mail_attachment_download_urls(message_id, attachment_ids)
        for attachment in attachments:
            attachment_id = attachment.get("attachment_id") or attachment.get("id")
            url = attachment_urls.get(attachment_id)
            name = attachment.get("filename") or attachment.get("name") or f"{attachment_id}.bin"
            if not name.lower().endswith(SUPPORTED_INVOICE_SUFFIXES):
                unsupported_attachment_names.append(name)
                continue
            if not url:
                failures.append({"message_id": message_id, "subject": subject, "url": "", "name": name, "error": "missing attachment download url"})
                continue
            message_supported_count += 1
            city = detect_city(subject, name)
            suffix = Path(name).suffix.lower()
            output_dir = image_dir if suffix in IMAGE_INVOICE_SUFFIXES else backup_dir
            key = invoice_key("mail_attachment", message_id, name)
            if not overwrite and is_processed(processed, key):
                skipped.append({"message_id": message_id, "subject": subject, "url": url, "name": name, "reason": "processed"})
                continue
            try:
                item = download_url(
                    url,
                    output_dir,
                    name,
                    source="mail_attachment",
                    message_id=message_id,
                    subject=subject,
                    overwrite=overwrite,
                    city=city,
                )
                downloaded.append(item)
                mark_processed(processed, key, {"source": item.source, "message_id": message_id, "subject": subject, "url": url, "path": item.path})
                save_processed_invoices(processed_path, processed)
            except Exception as exc:  # keep processing other invoices
                failures.append({"message_id": message_id, "subject": subject, "url": url or "", "error": str(exc)})

        # Linked invoice files in the message body.
        try:
            pdf_links = collect_invoice_links_from_message(message)
        except Exception as exc:
            link_error = str(exc)
            failures.append({"message_id": message_id, "subject": subject, "url": "", "error": str(exc)})
            pdf_links = []

        message_supported_count += len(pdf_links)
        for url, name in pdf_links:
            city = detect_city(subject, name)
            suffix = Path(name).suffix.lower()
            output_dir = image_dir if suffix in IMAGE_INVOICE_SUFFIXES else backup_dir
            key = invoice_key("body_link", name, url)
            if not overwrite and is_processed(processed, key):
                skipped.append({"message_id": message_id, "subject": subject, "url": url, "name": name, "reason": "processed"})
                continue
            try:
                item = download_url(
                    url,
                    output_dir,
                    name,
                    source="body_link",
                    message_id=message_id,
                    subject=subject,
                    overwrite=overwrite,
                    city=city,
                )
                downloaded.append(item)
                mark_processed(processed, key, {"source": item.source, "message_id": message_id, "subject": subject, "url": url, "path": item.path})
                save_processed_invoices(processed_path, processed)
            except Exception as exc:
                failures.append({"message_id": message_id, "subject": subject, "url": url, "error": str(exc)})

        if message_supported_count == 0:
            unsupported_messages.append({
                "message_id": message_id,
                "subject": subject,
                "unsupported_attachments": unsupported_attachment_names,
                "link_error": link_error,
                "reason": "no supported invoice file found",
            })

    return downloaded, failures, skipped, unsupported_messages


def refine_backup_city_dirs(backup_dir: Path) -> int:
    """Use XML invoice content to correct city folders before rendering PDFs."""
    moved = 0
    for xml_path in sorted(backup_dir.glob("*/*.xml")):
        try:
            text = xml_path.read_text(errors="ignore")[:30000]
        except Exception:
            continue
        city = detect_city(xml_path.name, text)
        if city == "未知城市" or city == xml_path.parent.name:
            continue

        source_dir = xml_path.parent
        target_dir = backup_dir / sanitize_filename(city)
        target_dir.mkdir(parents=True, exist_ok=True)
        base = xml_path.stem
        related = []
        for candidate in source_dir.iterdir():
            if not candidate.is_file():
                continue
            candidate_base = candidate.stem.replace("_查阅需OFD阅读器", "")
            if candidate_base == base or candidate_base.startswith(base) or base.startswith(candidate_base):
                related.append(candidate)
        if not related:
            related = [xml_path]

        for src in related:
            dst = unique_keep_suffix(target_dir / src.name)
            shutil.move(str(src), str(dst))
            moved += 1
    return moved


def convert_pdf_to_png(pdf_path: Path, image_dir: Path, *, size: int, overwrite: bool) -> ConversionResult:
    image_dir.mkdir(parents=True, exist_ok=True)
    target = image_dir / f"{pdf_path.stem}.png"
    generated = image_dir / f"{pdf_path.name}.png"

    if target.exists() and not overwrite:
        return ConversionResult(str(pdf_path), str(target), reused=True)
    if target.exists():
        target.unlink()
    if generated.exists():
        generated.unlink()

    proc = subprocess.run(
        ["qlmanage", "-t", "-s", str(size), "-o", str(image_dir), str(pdf_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=120,
    )
    if proc.returncode != 0 or not generated.exists():
        raise RuntimeError(f"qlmanage failed for {pdf_path}:\n{proc.stdout}")
    generated.rename(target)
    return ConversionResult(str(pdf_path), str(target))


def convert_all_pdfs(pdf_dir: Path, image_dir: Path, *, size: int, overwrite: bool) -> tuple[list[ConversionResult], list[dict[str, str]]]:
    results: list[ConversionResult] = []
    failures: list[dict[str, str]] = []
    pdfs = sorted(pdf_dir.glob("*.pdf")) + sorted(pdf_dir.glob("*/*.pdf"))
    for pdf in pdfs:
        try:
            target_image_dir = image_dir if pdf.parent == pdf_dir else image_dir / pdf.parent.name
            results.append(convert_pdf_to_png(pdf, target_image_dir, size=size, overwrite=overwrite))
        except Exception as exc:
            failures.append({"pdf": str(pdf), "error": str(exc)})
    return results, failures


def check_requirements() -> None:
    missing = []
    if not shutil.which("lark-cli"):
        missing.append("lark-cli")
    if not shutil.which("qlmanage"):
        missing.append("qlmanage")
    if missing:
        raise SystemExit(f"Missing required command(s): {', '.join(missing)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Download invoice PDFs from Feishu/Lark mail and convert them to PNG images.")
    parser.add_argument("--date", required=True, help="Mail date in YYYY-MM-DD, interpreted in the local timezone.")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT), help=f"Output root. Default: {DEFAULT_OUTPUT_ROOT}")
    parser.add_argument("--max", type=int, default=400, help="Max mails to read for that date. Default: 400")
    parser.add_argument("--image-size", type=int, default=DEFAULT_IMAGE_SIZE, help="PNG max dimension for qlmanage. Default: 2480")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing PDFs/images instead of reusing them.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    check_requirements()

    day = date.fromisoformat(args.date)
    date_dir = Path(args.output_root).expanduser() / day.isoformat()
    processed_path = date_dir / "processed_invoices.json"
    processed = load_processed_invoices(processed_path)
    seeded_count = seed_processed_from_legacy_outputs(date_dir, processed)
    if seeded_count:
        save_processed_invoices(processed_path, processed)

    run_id = run_id_for_now()
    run_dir = date_dir / run_id
    backup_dir = run_dir / "_backup"
    image_dir = run_dir
    run_dir.mkdir(parents=True, exist_ok=True)

    print(f"Reading mails for {day.isoformat()} ...")
    if seeded_count:
        print(f"Seeded {seeded_count} processed invoice(s) from legacy outputs for day-level dedupe.")
    messages = fetch_messages(day, args.max)
    invoice_messages = [m for m in messages if looks_like_invoice(m)]
    print(f"Found {len(messages)} mail(s), {len(invoice_messages)} invoice-like mail(s).")

    downloaded, download_failures, skipped_downloads, unsupported_messages = download_invoice_files(
        invoice_messages,
        backup_dir,
        image_dir,
        overwrite=args.overwrite,
        processed=processed,
        processed_path=processed_path,
    )
    backup_file_count = sum(len(list(backup_dir.glob(pattern))) for pattern in ("*.pdf", "*/*.pdf", "*.ofd", "*/*.ofd", "*.xml", "*/*.xml"))
    print(f"New invoice files this run: {backup_file_count}; skipped by day-level dedupe: {len(skipped_downloads)}; unsupported invoice-like mails: {len(unsupported_messages)}")

    refined_city_files = refine_backup_city_dirs(backup_dir)
    if refined_city_files:
        print(f"Refined city folders for {refined_city_files} backup file(s) using XML invoice content.")

    conversions, conversion_failures = convert_all_pdfs(backup_dir, image_dir, size=args.image_size, overwrite=args.overwrite)
    print(f"PNG images this run: {len(list(image_dir.glob('*.png'))) + len(list(image_dir.glob('*/*.png')))}; converted this run: {len(conversions)}")

    manifest = {
        "date": day.isoformat(),
        "run_id": run_id,
        "date_dir": str(date_dir),
        "run_dir": str(run_dir),
        "backup_dir": str(backup_dir),
        "image_dir": str(image_dir),
        "processed_path": str(processed_path),
        "mail_count": len(messages),
        "invoice_mail_count": len(invoice_messages),
        "refined_city_files": refined_city_files,
        "downloads": [asdict(item) for item in downloaded],
        "skipped_downloads": skipped_downloads,
        "unsupported_messages": unsupported_messages,
        "conversions": [asdict(item) for item in conversions],
        "download_failures": download_failures,
        "conversion_failures": conversion_failures,
    }
    manifest_path = run_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Images folder: {image_dir}")
    print(f"Manifest: {manifest_path}")
    if download_failures or conversion_failures:
        print("Completed with failures. See manifest.json for details.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
