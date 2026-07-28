fn main() {
    if let Err(error) = gate_h2_broker::handoff::run_from_args() {
        eprintln!("post-begin handoff failed closed: {error}");
        std::process::exit(1);
    }
}
