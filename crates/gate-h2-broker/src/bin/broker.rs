fn main() {
    if let Err(error) = gate_h2_broker::launcher::run_from_args() {
        eprintln!("gate-h2-broker: {error}");
        std::process::exit(78);
    }
}
