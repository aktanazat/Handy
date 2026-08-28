#[path = "agent-hook/mod.rs"]
mod agent_hook;

fn main() {
    std::process::exit(agent_hook::run_cli());
}
