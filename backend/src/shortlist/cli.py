import argparse
import asyncio
import json
import sys
from pathlib import Path

import uvicorn

from shortlist.config import HOST, get_config
from shortlist.db import run_migrations
from shortlist.llm.prompts import ACTIVE_PROMPT, PROMPTS

PROMPT_VERSIONS = tuple(PROMPTS)


def cmd_serve(args: argparse.Namespace) -> None:
    uvicorn.run("shortlist.main:app", host=HOST, port=args.port, reload=args.reload)


def cmd_migrate(args: argparse.Namespace) -> None:
    run_migrations(get_config().database_url)


def cmd_openapi(args: argparse.Namespace) -> None:
    from shortlist.main import create_app

    json.dump(create_app(frontend_dist=None).openapi(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


def cmd_eval(args: argparse.Namespace) -> None:
    from sqlmodel import Session

    from shortlist import evaluation
    from shortlist.db import get_engine
    from shortlist.llm.ollama_client import LLMUnavailable, OllamaClient
    from shortlist.llm.prompts import PROMPTS
    from shortlist.owner_settings import get_settings

    engine = get_engine()
    with Session(engine) as session:
        settings = get_settings(session)
        profile, model = settings.profile_text, args.model or settings.model_name
    try:
        result = asyncio.run(
            evaluation.evaluate(
                engine,
                OllamaClient(get_config().ollama_url),
                model,
                PROMPTS[args.prompt],
                profile,
                include_unlabelled=args.all,
                details_dir=evaluation.DETAILS_DIR,
            )
        )
    except (ValueError, LLMUnavailable) as exc:
        raise SystemExit(str(exc)) from exc
    path = evaluation.write_result(result)
    print(evaluation.results_table([result]))
    print(f"\nWritten to {path}")


def cmd_eval_table(args: argparse.Namespace) -> None:
    from shortlist import evaluation

    table = evaluation.results_table(evaluation.load_results())
    if args.write is None:
        print(table)
        return
    document = args.write.read_text()
    args.write.write_text(evaluation.replace_table(document, table))
    print(f"Updated {args.write}")


def cmd_costs(args: argparse.Namespace) -> None:
    from shortlist import evaluation
    from shortlist.db import get_engine

    report = evaluation.cost_report(get_engine())
    evaluation.RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = evaluation.RESULTS_DIR / evaluation.COSTS_FILE
    path.write_text(report.model_dump_json(indent=2) + "\n")
    for month in report.months:
        print(
            f"{month.month}: {month.runs} runs, {month.results_fetched} results, "
            f"${month.estimated_cost_usd:.3f}"
        )
    print(f"Written to {path}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="shortlist")
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help=f"run the API on {HOST} (local only)")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true", help="reload on code changes (dev)")
    serve.set_defaults(func=cmd_serve)

    migrate = sub.add_parser("migrate", help="upgrade the database schema to the latest revision")
    migrate.set_defaults(func=cmd_migrate)

    openapi = sub.add_parser("openapi", help="print the OpenAPI schema as JSON")
    openapi.set_defaults(func=cmd_openapi)

    evaluate = sub.add_parser(
        "eval", help="run the match decision on the labelled jobs and write eval/results/"
    )
    evaluate.add_argument("--model", help="Ollama model (default: the one in Settings)")
    evaluate.add_argument(
        "--prompt", choices=sorted(PROMPT_VERSIONS), default=ACTIVE_PROMPT.version
    )
    evaluate.add_argument(
        "--all",
        action="store_true",
        help="also run unlabelled jobs (they count for speed and valid JSON only)",
    )
    evaluate.set_defaults(func=cmd_eval)

    table = sub.add_parser("eval-table", help="print the comparison table of eval/results/")
    table.add_argument(
        "--write", type=Path, metavar="README", help="replace the table between the eval markers"
    )
    table.set_defaults(func=cmd_eval_table)

    costs = sub.add_parser("costs", help="write the estimated Apify cost per month from History")
    costs.set_defaults(func=cmd_costs)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    args.func(args)
